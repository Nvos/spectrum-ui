package main

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"time"
)

const (
	recordingFormatVersion = 1
	manifestFilename       = "manifest.json"
	recordingStateActive   = "recording"
	recordingStateComplete = "complete"
	recordingStateBroken   = "interrupted"
)

type recordingManifest struct {
	FormatVersion int       `json:"formatVersion"`
	RecordingID   string    `json:"recordingId"`
	SessionID     string    `json:"sessionId"`
	Name          string    `json:"name"`
	State         string    `json:"state"`
	FreqStart     int64     `json:"freqStart"`
	Resolution    int64     `json:"resolution"`
	BinCount      int       `json:"binCount"`
	HistoryRows   int       `json:"historyRows"`
	PageRows      int       `json:"pageRows"`
	SeqStart      uint64    `json:"seqStart"`
	SeqEnd        uint64    `json:"seqEnd"`
	PageCount     uint64    `json:"pageCount"`
	CreatedAt     int64     `json:"createdAt"`
	StartedAt     int64     `json:"startedAt"`
	EndedAt       *int64    `json:"endedAt,omitempty"`
	Retention     retention `json:"retention"`
	LiveFormat    string    `json:"liveFormat"`
	SegmentBytes  int64     `json:"segmentBytes"`
	Segments      []string  `json:"segments"`
}

type recording struct {
	manifest recordingManifest
	store    *pageStore
}

type recordingSource interface {
	recordingInfo() recordingManifest
	pagePayloads(from uint64, count int) ([][]byte, int, error)
	seek(timestamp int64) (uint64, bool)
}

func openRecording(dir string, fallbackSegmentBytes int64, markInterrupted bool) (*recording, error) {
	manifestPath := filepath.Join(dir, manifestFilename)
	manifest, err := readRecordingManifest(manifestPath)
	if err != nil {
		return nil, err
	}
	if manifest.FormatVersion != recordingFormatVersion || manifest.RecordingID == "" || manifest.PageRows <= 0 {
		return nil, errors.New("unsupported or invalid recording manifest")
	}
	manifest.SessionID = manifest.RecordingID
	if manifest.CreatedAt == 0 {
		manifest.CreatedAt = manifest.StartedAt
	}
	segmentBytes := manifest.SegmentBytes
	if segmentBytes <= 0 {
		segmentBytes = fallbackSegmentBytes
	}
	store, err := openPageStore(dir, segmentBytes)
	if err != nil {
		return nil, err
	}

	pageCount := store.PageCount()
	manifest.PageCount = pageCount
	manifest.SeqEnd = manifest.SeqStart
	if pageCount > 0 {
		_, lastHeader, err := readPageTimestamps(store, pageCount-1)
		if err != nil {
			_ = store.Close()
			return nil, fmt.Errorf("read final recording page: %w", err)
		}
		manifest.SeqEnd = lastHeader.SeqStart + uint64(lastHeader.Rows)
	}
	manifest.Retention = retention{Rows: int(manifest.SeqEnd - manifest.SeqStart), Policy: "session"}
	manifest.Segments = store.SegmentNames()
	if markInterrupted && manifest.State == recordingStateActive {
		manifest.State = recordingStateBroken
		endedAt := manifest.StartedAt
		if pageCount > 0 {
			if timestamps, _, err := readPageTimestamps(store, pageCount-1); err == nil && len(timestamps) > 0 {
				endedAt = int64(timestamps[len(timestamps)-1])
			}
		}
		manifest.EndedAt = &endedAt
	}
	if err := writeManifestAtomic(manifestPath, manifest); err != nil {
		_ = store.Close()
		return nil, err
	}
	return &recording{manifest: manifest, store: store}, nil
}

func loadRecordingCatalog(dataDir string, segmentBytes int64) (map[string]*recording, []error, error) {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, nil, err
	}
	entries, err := os.ReadDir(dataDir)
	if err != nil {
		return nil, nil, err
	}
	recordings := make(map[string]*recording)
	warnings := make([]error, 0)
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		dir := filepath.Join(dataDir, entry.Name())
		if _, err := os.Stat(filepath.Join(dir, manifestFilename)); err != nil {
			continue
		}
		recording, err := openRecording(dir, segmentBytes, true)
		if err != nil {
			warnings = append(warnings, fmt.Errorf("load recording %s: %w", entry.Name(), err))
			continue
		}
		if _, exists := recordings[recording.manifest.RecordingID]; exists {
			_ = recording.store.Close()
			warnings = append(warnings, fmt.Errorf("duplicate recording id %s", recording.manifest.RecordingID))
			continue
		}
		recordings[recording.manifest.RecordingID] = recording
	}
	return recordings, warnings, nil
}

func (r *recording) recordingInfo() recordingManifest {
	return r.manifest
}

func (r *recording) pagePayloads(from uint64, count int) ([][]byte, int, error) {
	firstRetainedPage := r.manifest.SeqStart / uint64(r.manifest.PageRows)
	if from < firstRetainedPage {
		return nil, http.StatusGone, nil
	}
	available := r.store.PageCount()
	if from > available || uint64(count) > available-from {
		return nil, http.StatusNotFound, nil
	}
	pages := make([][]byte, count)
	for page := range pages {
		payload, err := r.store.ReadPage(from + uint64(page))
		if err != nil {
			return nil, http.StatusInternalServerError, err
		}
		pages[page] = payload
	}
	return pages, http.StatusOK, nil
}

func (r *recording) seek(timestamp int64) (uint64, bool) {
	pageCount := r.store.PageCount()
	if pageCount == 0 {
		return 0, false
	}
	lo, hi := uint64(0), pageCount
	for lo < hi {
		mid := lo + (hi-lo)/2
		timestamps, _, err := readPageTimestamps(r.store, mid)
		if err != nil || len(timestamps) == 0 {
			return 0, false
		}
		if int64(timestamps[len(timestamps)-1]) < timestamp {
			lo = mid + 1
		} else {
			hi = mid
		}
	}
	if lo == pageCount {
		lo = pageCount - 1
	}
	timestamps, header, err := readPageTimestamps(r.store, lo)
	if err != nil || len(timestamps) == 0 {
		return 0, false
	}
	row := sort.Search(len(timestamps), func(index int) bool {
		return int64(timestamps[index]) >= timestamp
	})
	if row == len(timestamps) {
		row--
	}
	return header.SeqStart + uint64(row), true
}

func readPageTimestamps(store *pageStore, page uint64) ([]float64, pageHeader, error) {
	var header pageHeader
	headerLengthBytes, err := store.ReadPageRange(page, 0, 4)
	if err != nil {
		return nil, header, err
	}
	headerLength := int64(binary.LittleEndian.Uint32(headerLengthBytes))
	headerBytes, err := store.ReadPageRange(page, 4, headerLength)
	if err != nil {
		return nil, header, err
	}
	if err := json.Unmarshal(headerBytes, &header); err != nil {
		return nil, header, err
	}
	if header.Rows <= 0 {
		return nil, header, errors.New("history page has no rows")
	}
	timestampBytes, err := store.ReadPageRange(page, 4+headerLength, int64(header.Rows*8))
	if err != nil {
		return nil, header, err
	}
	timestamps := make([]float64, header.Rows)
	for index := range timestamps {
		bits := binary.LittleEndian.Uint64(timestampBytes[index*8 : index*8+8])
		timestamps[index] = math.Float64frombits(bits)
	}
	return timestamps, header, nil
}

func readRecordingManifest(path string) (recordingManifest, error) {
	var manifest recordingManifest
	payload, err := os.ReadFile(path)
	if err != nil {
		return manifest, err
	}
	if err := json.Unmarshal(payload, &manifest); err != nil {
		return manifest, err
	}
	return manifest, nil
}

func writeManifestAtomic(path string, manifest recordingManifest) error {
	payload, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return err
	}
	payload = append(payload, '\n')
	temporary := path + ".tmp"
	file, err := os.OpenFile(temporary, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	if err := writeAll(file, payload); err != nil {
		_ = file.Close()
		_ = os.Remove(temporary)
		return err
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		_ = os.Remove(temporary)
		return err
	}
	if err := file.Close(); err != nil {
		_ = os.Remove(temporary)
		return err
	}
	if err := os.Rename(temporary, path); err != nil {
		_ = os.Remove(temporary)
		return err
	}
	return nil
}

func defaultRecordingName(startedAt int64) string {
	return "Recording " + time.UnixMilli(startedAt).UTC().Format(time.RFC3339)
}
