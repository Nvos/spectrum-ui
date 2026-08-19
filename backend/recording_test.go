package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
)

func TestRecordingSurvivesRestartAndCanReplay(t *testing.T) {
	dataDir := t.TempDir()
	serverBefore, err := newServer(dataDir, 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	capture, err := serverBefore.replaceCapture(captureConfig{
		Name: "Morning scan", FreqStart: 25_000, Resolution: 1_500, BinCount: 64, HistoryRows: 512,
	})
	if err != nil {
		t.Fatal(err)
	}
	recordingID := capture.id
	startedAt := capture.startedAt
	activeManifest, err := readRecordingManifest(capture.manifestPath)
	if err != nil {
		t.Fatal(err)
	}
	if activeManifest.State != recordingStateActive || activeManifest.RecordingID != recordingID || activeManifest.PageCount == 0 {
		t.Fatalf("startup recording was not durably initialized: %+v", activeManifest)
	}
	serverBefore.close()

	serverAfter, err := newServer(dataDir, 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	defer serverAfter.close()

	archived, ok := serverAfter.recordings[recordingID]
	if !ok {
		t.Fatalf("recording %s was not loaded after restart", recordingID)
	}
	info := archived.recordingInfo()
	if info.Name != "Morning scan" || info.State != recordingStateComplete {
		t.Fatalf("unexpected recording info after restart: %+v", info)
	}
	if info.PageCount == 0 || info.SeqEnd == 0 {
		t.Fatalf("recording extent was not rebuilt from pages: %+v", info)
	}

	listRequest := httptest.NewRequest(http.MethodGet, "/api/recordings", nil)
	listResponse := httptest.NewRecorder()
	serverAfter.routes().ServeHTTP(listResponse, listRequest)
	if listResponse.Code != http.StatusOK {
		t.Fatalf("list status = %d: %s", listResponse.Code, listResponse.Body.String())
	}
	var list []recordingManifest
	if err := json.Unmarshal(listResponse.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].RecordingID != recordingID {
		t.Fatalf("recording list = %+v", list)
	}

	pageRequest := httptest.NewRequest(http.MethodGet, "/api/recordings/"+recordingID+"/pages?from=0&count=1", nil)
	pageRequest.SetPathValue("recordingID", recordingID)
	pageResponse := httptest.NewRecorder()
	serverAfter.routes().ServeHTTP(pageResponse, pageRequest)
	if pageResponse.Code != http.StatusOK {
		t.Fatalf("replay page status = %d: %s", pageResponse.Code, pageResponse.Body.String())
	}
	header := decodePageHeader(t, pageResponse.Body.Bytes())
	if header.SeqStart != 0 || header.BinCount != 64 {
		t.Fatalf("unexpected replay page header: %+v", header)
	}

	seq, found := archived.seek(startedAt + 100*tickInterval.Milliseconds())
	if !found || seq != 100 {
		t.Fatalf("archived seek = (%d, %t), want (100, true)", seq, found)
	}
}

func TestStartupMarksUnfinishedRecordingInterrupted(t *testing.T) {
	dataDir := t.TempDir()
	capture, err := newCapture(captureConfig{
		FreqStart: 25_000, Resolution: 1_500, BinCount: 64, HistoryRows: 512,
	}, dataDir, 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	recordingID := capture.id
	if err := capture.store.Close(); err != nil {
		t.Fatal(err)
	}

	server, err := newServer(dataDir, 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	defer server.close()
	archived, ok := server.recordings[recordingID]
	if !ok {
		t.Fatalf("interrupted recording %s was not cataloged", recordingID)
	}
	info := archived.recordingInfo()
	if info.State != recordingStateBroken || info.EndedAt == nil {
		t.Fatalf("unfinished recording was not marked interrupted: %+v", info)
	}
}

func TestCleanStopSealsFinalPartialPage(t *testing.T) {
	dataDir := t.TempDir()
	capture, err := newCapture(captureConfig{
		FreqStart: 25_000, Resolution: 1_500, BinCount: 64, HistoryRows: 512,
	}, dataDir, 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	if err := capture.appendRow(row{
		TimestampMS: float64(capture.startedAt + int64(initialRows)*tickInterval.Milliseconds()),
		Spectrum:    make([]int8, 64),
	}); err != nil {
		t.Fatal(err)
	}
	capture.stop()

	archived, err := openRecording(filepath.Join(dataDir, capture.id), 1<<20, false)
	if err != nil {
		t.Fatal(err)
	}
	defer archived.store.Close()
	info := archived.recordingInfo()
	if info.SeqEnd != initialRows+1 || info.PageCount != 3 {
		t.Fatalf("partial page extent = pages %d, seqEnd %d", info.PageCount, info.SeqEnd)
	}
	payload, err := archived.store.ReadPage(info.PageCount - 1)
	if err != nil {
		t.Fatal(err)
	}
	header := decodePageHeader(t, payload)
	if header.Rows != 1 || header.SeqStart != initialRows {
		t.Fatalf("unexpected final partial page: %+v", header)
	}
}
