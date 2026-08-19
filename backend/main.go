package main

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"math"
	"math/rand/v2"
	"net/http"
	"os"
	osSignal "os/signal"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

const (
	defaultAddress     = "127.0.0.1:8787"
	defaultFrequency   = 25_000
	defaultResolution  = 1_500
	defaultBinCount    = 4_000
	initialRows        = 1_024
	tickInterval       = 60 * time.Millisecond
	occupancyThreshold = -85
	powerNoReading     = -128
	maxBatchPages      = 8
	defaultHotRows     = 4_096
	defaultSegmentMB   = 1_024
)

type captureConfig struct {
	Name        string `json:"name,omitempty"`
	FreqStart   int64  `json:"freqStart"`
	Resolution  int64  `json:"resolution"`
	BinCount    int    `json:"binCount"`
	HistoryRows int    `json:"historyRows,omitempty"`
}

type retention struct {
	Rows   int    `json:"rows"`
	Policy string `json:"policy"`
}

type metadata struct {
	SessionID  string    `json:"sessionId"`
	FreqStart  int64     `json:"freqStart"`
	Resolution int64     `json:"resolution"`
	BinCount   int       `json:"binCount"`
	PageRows   int       `json:"pageRows"`
	SeqStart   uint64    `json:"seqStart"`
	SeqEnd     uint64    `json:"seqEnd"`
	StartedAt  int64     `json:"startedAt"`
	Retention  retention `json:"retention"`
	LiveFormat string    `json:"liveFormat"`
}

type interval struct {
	Start uint16
	End   uint16
	Value int8
}

type row struct {
	Seq         uint64
	TimestampMS float64
	Spectrum    []int8
	Annotations []interval
}

type signal struct {
	bin, halfBandwidth int
	peakDBM            float64
	active             bool
	ticksLeft          int
	continuous         bool
}

type capture struct {
	mu            sync.RWMutex
	id            string
	config        captureConfig
	pageRows      int
	createdAt     int64
	startedAt     int64
	seqStart      uint64
	seqEnd        uint64
	durableSeqEnd uint64
	hotRows       []row
	hotStart      uint64
	tail          []row
	timestamps    []float64
	store         *pageStore
	manifestPath  string
	finalManifest *recordingManifest
	subscribers   map[chan row]struct{}
	signals       []signal
	cancel        context.CancelFunc
	stopOnce      sync.Once
}

type server struct {
	mu           sync.RWMutex
	current      *capture
	dataDir      string
	segmentBytes int64
	recordings   map[string]*recording
}

func main() {
	address := flag.String("addr", defaultAddress, "HTTP listen address")
	dataDir := flag.String("data-dir", "data", "directory for capture history files")
	segmentMB := flag.Int64("segment-mb", defaultSegmentMB, "maximum segment file size in MiB")
	recordingName := flag.String("recording-name", "", "optional name for the startup recording")
	flag.Parse()
	if *segmentMB <= 0 {
		log.Fatal("segment-mb must be positive")
	}

	s, err := newServer(*dataDir, *segmentMB<<20)
	if err != nil {
		log.Fatal(err)
	}
	if _, err := s.replaceCapture(captureConfig{Name: *recordingName, FreqStart: defaultFrequency, Resolution: defaultResolution, BinCount: defaultBinCount}); err != nil {
		log.Fatal(err)
	}
	defer s.close()

	httpServer := &http.Server{
		Addr:              *address,
		Handler:           s.routes(),
		ReadHeaderTimeout: 5 * time.Second,
	}
	shutdownSignal := make(chan os.Signal, 1)
	osSignal.Notify(shutdownSignal, os.Interrupt, syscall.SIGTERM)
	defer osSignal.Stop(shutdownSignal)
	go func() {
		<-shutdownSignal
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = httpServer.Shutdown(ctx)
	}()
	log.Printf("Spectrum mock API listening on http://%s", *address)
	if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func (s *server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", s.health)
	mux.HandleFunc("GET /api/captures/current", s.currentCapture)
	mux.HandleFunc("POST /api/captures", s.createCapture)
	mux.HandleFunc("GET /api/captures/{sessionID}", s.captureMetadata)
	mux.HandleFunc("GET /api/captures/{sessionID}/pages", s.capturePages)
	mux.HandleFunc("GET /api/captures/{sessionID}/seek", s.captureSeek)
	mux.HandleFunc("GET /api/captures/{sessionID}/live", s.captureLive)
	mux.HandleFunc("GET /api/recordings", s.listRecordings)
	mux.HandleFunc("GET /api/recordings/{recordingID}", s.recordingMetadata)
	mux.HandleFunc("GET /api/recordings/{recordingID}/pages", s.recordingPages)
	mux.HandleFunc("GET /api/recordings/{recordingID}/seek", s.recordingSeek)
	return withMiddleware(mux)
}

func withMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *server) currentCapture(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.getCurrent().metadata())
}

func (s *server) createCapture(w http.ResponseWriter, r *http.Request) {
	var cfg captureConfig
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&cfg); err != nil {
		writeError(w, http.StatusBadRequest, "invalid capture configuration")
		return
	}
	if cfg.FreqStart < 0 || cfg.Resolution <= 0 || cfg.BinCount < 64 || cfg.BinCount > 8_192 {
		writeError(w, http.StatusBadRequest, "freqStart must be non-negative, resolution positive, and binCount between 64 and 8192")
		return
	}
	if len(strings.TrimSpace(cfg.Name)) > 128 {
		writeError(w, http.StatusBadRequest, "name must be at most 128 characters")
		return
	}
	if cfg.HistoryRows < 512 || cfg.HistoryRows > 8_192 || cfg.HistoryRows&(cfg.HistoryRows-1) != 0 {
		writeError(w, http.StatusBadRequest, "historyRows must be a power of two between 512 and 8192")
		return
	}
	c, err := s.replaceCapture(cfg)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not create capture storage")
		return
	}
	writeJSON(w, http.StatusCreated, c.metadata())
}

func (s *server) captureMetadata(w http.ResponseWriter, r *http.Request) {
	c, ok := s.captureForRequest(r)
	if !ok {
		writeError(w, http.StatusConflict, "capture session changed")
		return
	}
	writeJSON(w, http.StatusOK, c.metadata())
}

func (s *server) capturePages(w http.ResponseWriter, r *http.Request) {
	c, ok := s.captureForRequest(r)
	if !ok {
		writeError(w, http.StatusConflict, "capture session changed")
		return
	}
	s.servePages(w, r, c, c.id)
}

func (s *server) servePages(w http.ResponseWriter, r *http.Request, source recordingSource, recordingID string) {
	from, err := strconv.ParseUint(r.URL.Query().Get("from"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "from must be a page index")
		return
	}
	count := 1
	if raw := r.URL.Query().Get("count"); raw != "" {
		count, err = strconv.Atoi(raw)
		if err != nil || count < 1 || count > maxBatchPages {
			writeError(w, http.StatusBadRequest, "count must be between 1 and 8")
			return
		}
	}

	pages, status, err := source.pagePayloads(from, count)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not read capture history")
		return
	}
	if status != http.StatusOK {
		message := "page not available"
		if status == http.StatusGone {
			message = "page expired from retention"
		}
		writeError(w, status, message)
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	w.Header().Set("ETag", fmt.Sprintf("\"%s/p/%d/%d\"", recordingID, from, count))
	for _, page := range pages {
		if _, err := w.Write(page); err != nil {
			return
		}
	}
}

func (s *server) captureSeek(w http.ResponseWriter, r *http.Request) {
	c, ok := s.captureForRequest(r)
	if !ok {
		writeError(w, http.StatusConflict, "capture session changed")
		return
	}
	s.serveSeek(w, r, c)
}

func (s *server) serveSeek(w http.ResponseWriter, r *http.Request, source recordingSource) {
	timestamp, err := strconv.ParseInt(r.URL.Query().Get("t"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "t must be epoch milliseconds")
		return
	}
	seq, found := source.seek(timestamp)
	if !found {
		writeError(w, http.StatusNotFound, "capture has no rows")
		return
	}
	writeJSON(w, http.StatusOK, map[string]uint64{"seq": seq})
}

func (s *server) listRecordings(w http.ResponseWriter, _ *http.Request) {
	items := make([]recordingManifest, 0)
	current := s.getCurrent()
	if current != nil {
		items = append(items, current.recordingInfo())
	}
	s.mu.RLock()
	for _, item := range s.recordings {
		items = append(items, item.recordingInfo())
	}
	s.mu.RUnlock()
	sort.Slice(items, func(left, right int) bool { return items[left].StartedAt > items[right].StartedAt })
	writeJSON(w, http.StatusOK, items)
}

func (s *server) recordingMetadata(w http.ResponseWriter, r *http.Request) {
	source, ok := s.recordingForID(r.PathValue("recordingID"))
	if !ok {
		writeError(w, http.StatusNotFound, "recording not found")
		return
	}
	writeJSON(w, http.StatusOK, source.recordingInfo())
}

func (s *server) recordingPages(w http.ResponseWriter, r *http.Request) {
	source, ok := s.recordingForID(r.PathValue("recordingID"))
	if !ok {
		writeError(w, http.StatusNotFound, "recording not found")
		return
	}
	s.servePages(w, r, source, source.recordingInfo().RecordingID)
}

func (s *server) recordingSeek(w http.ResponseWriter, r *http.Request) {
	source, ok := s.recordingForID(r.PathValue("recordingID"))
	if !ok {
		writeError(w, http.StatusNotFound, "recording not found")
		return
	}
	s.serveSeek(w, r, source)
}

func (s *server) captureLive(w http.ResponseWriter, r *http.Request) {
	c, ok := s.captureForRequest(r)
	if !ok {
		writeError(w, http.StatusConflict, "capture session changed")
		return
	}
	after := uint64(0)
	hasAfter := false
	if raw := r.URL.Query().Get("after"); raw != "" {
		var err error
		after, err = strconv.ParseUint(raw, 10, 64)
		if err != nil {
			writeError(w, http.StatusBadRequest, "after must be a sequence number")
			return
		}
		hasAfter = true
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "streaming unsupported")
		return
	}
	backlog, updates, unsubscribe, status := c.subscribe(after, hasAfter)
	if status != http.StatusOK {
		writeError(w, status, "requested live backlog expired")
		return
	}
	defer unsubscribe()
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	for _, item := range backlog {
		if err := writeLiveFrame(w, item); err != nil {
			return
		}
	}
	flusher.Flush()
	for {
		select {
		case <-r.Context().Done():
			return
		case item, open := <-updates:
			if !open {
				return
			}
			if err := writeLiveFrame(w, item); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

func (s *server) captureForRequest(r *http.Request) (*capture, bool) {
	c := s.getCurrent()
	return c, c.id == r.PathValue("sessionID")
}

func (s *server) getCurrent() *capture {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.current
}

func newServer(dataDir string, segmentBytes int64) (*server, error) {
	recordings, warnings, err := loadRecordingCatalog(dataDir, segmentBytes)
	if err != nil {
		return nil, fmt.Errorf("load recording catalog: %w", err)
	}
	for _, warning := range warnings {
		log.Print(warning)
	}
	return &server{dataDir: dataDir, segmentBytes: segmentBytes, recordings: recordings}, nil
}

func (s *server) recordingForID(id string) (recordingSource, bool) {
	current := s.getCurrent()
	if current != nil && current.id == id {
		return current, true
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	recording, ok := s.recordings[id]
	return recording, ok
}

func (s *server) close() {
	current := s.getCurrent()
	if current != nil {
		current.stop()
	}
	s.mu.RLock()
	recordings := make([]*recording, 0, len(s.recordings))
	for _, item := range s.recordings {
		recordings = append(recordings, item)
	}
	s.mu.RUnlock()
	for _, item := range recordings {
		_ = item.store.Close()
	}
}

func (s *server) replaceCapture(cfg captureConfig) (*capture, error) {
	c, err := newCapture(cfg, s.dataDir, s.segmentBytes)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	previous := s.current
	s.current = c
	s.mu.Unlock()
	if previous != nil {
		archived := previous.archiveRecording()
		s.mu.Lock()
		if s.recordings == nil {
			s.recordings = make(map[string]*recording)
		}
		s.recordings[previous.id] = archived
		s.mu.Unlock()
	}
	c.start()
	log.Printf("Started recording %s (%s)", c.id, c.config.Name)
	return c, nil
}

func newCapture(cfg captureConfig, dataDir string, segmentBytes int64) (*capture, error) {
	if len(strings.TrimSpace(cfg.Name)) > 128 {
		return nil, errors.New("recording name must be at most 128 characters")
	}
	if cfg.HistoryRows <= 0 {
		cfg.HistoryRows = defaultHotRows
	}
	if segmentBytes <= 0 {
		segmentBytes = int64(defaultSegmentMB) << 20
	}
	pageRows := pageRowsFor(cfg.BinCount)
	now := time.Now()
	id := fmt.Sprintf("cap_%x", now.UnixNano())
	if strings.TrimSpace(cfg.Name) == "" {
		cfg.Name = defaultRecordingName(now.UnixMilli())
	} else {
		cfg.Name = strings.TrimSpace(cfg.Name)
	}
	store, err := openPageStore(filepath.Join(dataDir, id), segmentBytes)
	if err != nil {
		return nil, err
	}
	hotCapacity := max(defaultHotRows, cfg.HistoryRows)
	c := &capture{
		id:           id,
		config:       cfg,
		pageRows:     pageRows,
		createdAt:    now.UnixMilli(),
		startedAt:    now.UnixMilli() - int64(initialRows-1)*tickInterval.Milliseconds(),
		hotRows:      make([]row, hotCapacity),
		tail:         make([]row, 0, pageRows),
		timestamps:   make([]float64, 0, initialRows),
		store:        store,
		manifestPath: filepath.Join(dataDir, id, manifestFilename),
		subscribers:  make(map[chan row]struct{}),
		signals:      defaultSignals(),
		cancel:       func() {},
	}
	if err := c.persistManifestLocked(recordingStateActive, nil); err != nil {
		_ = store.Close()
		return nil, fmt.Errorf("create recording manifest: %w", err)
	}
	for i := 0; i < initialRows; i++ {
		timestamp := now.Add(-time.Duration(initialRows-1-i) * tickInterval)
		if err := c.appendGenerated(timestamp); err != nil {
			_ = store.Close()
			return nil, fmt.Errorf("seed capture history: %w", err)
		}
	}
	return c, nil
}

func (c *capture) start() {
	ctx, cancel := context.WithCancel(context.Background())
	oldCancel := c.cancel
	c.cancel = func() { cancel(); oldCancel() }
	go func() {
		ticker := time.NewTicker(tickInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case now := <-ticker.C:
				if err := c.appendGenerated(now); err != nil {
					log.Printf("capture %s stopped: %v", c.id, err)
					return
				}
			}
		}
	}()
}

func (c *capture) stop() {
	c.finish(true)
}

func (c *capture) archiveRecording() *recording {
	c.finish(false)
	c.mu.RLock()
	defer c.mu.RUnlock()
	manifest := *c.finalManifest
	return &recording{manifest: manifest, store: c.store}
}

func (c *capture) finish(closeStore bool) {
	c.stopOnce.Do(func() {
		c.cancel()
		c.mu.Lock()
		defer c.mu.Unlock()
		for subscriber := range c.subscribers {
			close(subscriber)
			delete(c.subscribers, subscriber)
		}
		if len(c.tail) > 0 {
			payload, err := encodePage(c.tail, c.config.BinCount)
			if err == nil {
				err = c.store.Append(payload)
			}
			if err != nil {
				log.Printf("finalize recording %s tail: %v", c.id, err)
			} else {
				c.durableSeqEnd = c.seqEnd
				c.tail = c.tail[:0]
			}
		}
		endedAt := time.Now().UnixMilli()
		manifest := c.manifestLocked(recordingStateComplete, &endedAt)
		c.finalManifest = &manifest
		if err := writeManifestAtomic(c.manifestPath, manifest); err != nil {
			log.Printf("complete recording %s manifest: %v", c.id, err)
		}
		if closeStore {
			if err := c.store.Close(); err != nil {
				log.Printf("close capture %s storage: %v", c.id, err)
			}
		}
	})
}

func (c *capture) appendGenerated(timestamp time.Time) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	item := c.generateRow(timestamp)
	return c.appendRowLocked(item)
}

func (c *capture) appendRow(item row) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	item.Seq = c.seqEnd
	return c.appendRowLocked(item)
}

func (c *capture) appendRowLocked(item row) error {
	item.Seq = c.seqEnd
	if len(c.tail)+1 == c.pageRows {
		page := make([]row, c.pageRows)
		copy(page, c.tail)
		page[len(page)-1] = item
		payload, err := encodePage(page, c.config.BinCount)
		if err != nil {
			return err
		}
		if err := c.store.Append(payload); err != nil {
			return err
		}
		c.durableSeqEnd = item.Seq + 1
		if err := c.persistManifestLocked(recordingStateActive, nil); err != nil {
			log.Printf("update recording %s manifest: %v", c.id, err)
		}
		c.tail = c.tail[:0]
	} else {
		c.tail = append(c.tail, item)
	}
	c.hotRows[item.Seq%uint64(len(c.hotRows))] = item
	c.timestamps = append(c.timestamps, item.TimestampMS)
	c.seqEnd++
	if c.seqEnd > uint64(len(c.hotRows)) {
		c.hotStart = c.seqEnd - uint64(len(c.hotRows))
	}
	for subscriber := range c.subscribers {
		select {
		case subscriber <- item:
		default:
			close(subscriber)
			delete(c.subscribers, subscriber)
		}
	}
	return nil
}

func (c *capture) recordingInfo() recordingManifest {
	c.mu.RLock()
	defer c.mu.RUnlock()
	manifest := c.manifestLocked(recordingStateActive, nil)
	manifest.SeqEnd = c.seqEnd
	manifest.Retention.Rows = int(c.seqEnd - c.seqStart)
	return manifest
}

func (c *capture) persistManifestLocked(state string, endedAt *int64) error {
	return writeManifestAtomic(c.manifestPath, c.manifestLocked(state, endedAt))
}

func (c *capture) manifestLocked(state string, endedAt *int64) recordingManifest {
	pageCount := c.store.PageCount()
	seqEnd := c.durableSeqEnd
	return recordingManifest{
		FormatVersion: recordingFormatVersion, RecordingID: c.id, SessionID: c.id, Name: c.config.Name, State: state,
		FreqStart: c.config.FreqStart, Resolution: c.config.Resolution, BinCount: c.config.BinCount,
		HistoryRows: c.config.HistoryRows, PageRows: c.pageRows, SeqStart: c.seqStart, SeqEnd: seqEnd,
		PageCount: pageCount, CreatedAt: c.createdAt, StartedAt: c.startedAt, EndedAt: endedAt,
		Retention:  retention{Rows: int(seqEnd - c.seqStart), Policy: "session"},
		LiveFormat: "spectrum-live-binary-v1", SegmentBytes: c.store.maxSegmentBytes,
		Segments: c.store.SegmentNames(),
	}
}

func (c *capture) generateRow(timestamp time.Time) row {
	for i := range c.signals {
		s := &c.signals[i]
		if s.continuous {
			continue
		}
		if s.active {
			s.ticksLeft--
			if s.ticksLeft <= 0 {
				s.active = false
			}
		} else if rand.Float64() < 0.02 {
			s.active = true
			s.ticksLeft = int(math.Ceil(-math.Log(max(rand.Float64(), 1e-9)) * 25))
		}
	}
	spectrum := make([]int8, c.config.BinCount)
	annotations := make([]interval, 0, len(c.signals))
	for _, s := range c.signals {
		if !s.active || s.bin >= c.config.BinCount {
			continue
		}
		lo := max(0, s.bin-s.halfBandwidth)
		hi := min(c.config.BinCount-1, s.bin+s.halfBandwidth)
		annotations = append(annotations, interval{Start: uint16(lo), End: uint16(hi), Value: 0})
	}
	for bin := range spectrum {
		dbm := -90.0 + (rand.Float64()+rand.Float64()-1)*4
		for _, s := range c.signals {
			if !s.active {
				continue
			}
			distance := abs(bin - s.bin)
			if distance > s.halfBandwidth+1 {
				continue
			}
			rolloff := 0.0
			if distance > s.halfBandwidth {
				rolloff = 10
			} else if distance == s.halfBandwidth {
				rolloff = 3
			}
			value := s.peakDBM - rolloff + (rand.Float64()-0.5)*1.5
			if value > dbm {
				dbm = value
			}
		}
		spectrum[bin] = int8(max(-127, min(127, math.Round(dbm))))
	}
	return row{Seq: c.seqEnd, TimestampMS: float64(timestamp.UnixMilli()), Spectrum: spectrum, Annotations: annotations}
}

func (c *capture) metadata() metadata {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return metadata{
		SessionID: c.id, FreqStart: c.config.FreqStart, Resolution: c.config.Resolution,
		BinCount: c.config.BinCount, PageRows: c.pageRows, SeqStart: c.seqStart, SeqEnd: c.seqEnd,
		StartedAt: c.startedAt, Retention: retention{Rows: int(c.seqEnd - c.seqStart), Policy: "session"},
		LiveFormat: "spectrum-live-binary-v1",
	}
}

func (c *capture) pagePayloads(from uint64, count int) ([][]byte, int, error) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	firstRetainedPage := c.seqStart / uint64(c.pageRows)
	if from < firstRetainedPage {
		return nil, http.StatusGone, nil
	}
	available := c.store.PageCount()
	if from > available || uint64(count) > available-from {
		return nil, http.StatusNotFound, nil
	}
	pages := make([][]byte, count)
	for p := 0; p < count; p++ {
		payload, err := c.store.ReadPage(from + uint64(p))
		if err != nil {
			return nil, http.StatusInternalServerError, err
		}
		pages[p] = payload
	}
	return pages, http.StatusOK, nil
}

func (c *capture) seek(timestamp int64) (uint64, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if c.seqStart == c.seqEnd {
		return 0, false
	}
	lo, hi := c.seqStart, c.seqEnd
	for lo < hi {
		mid := lo + (hi-lo)/2
		if int64(c.timestamps[mid-c.seqStart]) < timestamp {
			lo = mid + 1
		} else {
			hi = mid
		}
	}
	if lo == c.seqEnd {
		return c.seqEnd - 1, true
	}
	return lo, true
}

func (c *capture) subscribe(after uint64, hasAfter bool) ([]row, <-chan row, func(), int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	start := c.seqEnd
	if hasAfter {
		if after == ^uint64(0) {
			start = c.seqEnd
		} else if after+1 < c.hotStart {
			return nil, nil, func() {}, http.StatusGone
		} else {
			start = min(after+1, c.seqEnd)
		}
	}
	backlog := make([]row, 0, c.seqEnd-start)
	for seq := start; seq < c.seqEnd; seq++ {
		item := c.hotRows[seq%uint64(len(c.hotRows))]
		if item.Seq != seq {
			return nil, nil, func() {}, http.StatusGone
		}
		backlog = append(backlog, item)
	}
	updates := make(chan row, 1_024)
	c.subscribers[updates] = struct{}{}
	unsubscribe := func() {
		c.mu.Lock()
		defer c.mu.Unlock()
		if _, exists := c.subscribers[updates]; exists {
			delete(c.subscribers, updates)
			close(updates)
		}
	}
	return backlog, updates, unsubscribe, http.StatusOK
}

type pageHeader struct {
	SeqStart    uint64 `json:"seqStart"`
	Rows        int    `json:"rows"`
	BinCount    int    `json:"binCount"`
	Annotations struct {
		Encoding   string `json:"encoding"`
		ByteLength int    `json:"byteLength"`
	} `json:"annotations"`
}

func encodePage(rows []row, binCount int) ([]byte, error) {
	var buffer bytes.Buffer
	if err := writePage(&buffer, rows, binCount); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

func writePage(w io.Writer, rows []row, binCount int) error {
	annotationBytes := 0
	for _, item := range rows {
		annotationBytes += 2 + len(item.Annotations)*5
	}
	header := pageHeader{SeqStart: rows[0].Seq, Rows: len(rows), BinCount: binCount}
	header.Annotations.Encoding = "intervals-v1"
	header.Annotations.ByteLength = annotationBytes
	headerJSON, err := json.Marshal(header)
	if err != nil {
		return err
	}
	if err := binary.Write(w, binary.LittleEndian, uint32(len(headerJSON))); err != nil {
		return err
	}
	if _, err := w.Write(headerJSON); err != nil {
		return err
	}
	for _, item := range rows {
		if err := binary.Write(w, binary.LittleEndian, item.TimestampMS); err != nil {
			return err
		}
	}
	for _, item := range rows {
		if _, err := w.Write(int8Bytes(item.Spectrum)); err != nil {
			return err
		}
	}
	for _, item := range rows {
		if err := binary.Write(w, binary.LittleEndian, uint16(len(item.Annotations))); err != nil {
			return err
		}
		for _, annotation := range item.Annotations {
			if err := binary.Write(w, binary.LittleEndian, annotation.Start); err != nil {
				return err
			}
			if err := binary.Write(w, binary.LittleEndian, annotation.End); err != nil {
				return err
			}
			if _, err := w.Write([]byte{byte(annotation.Value)}); err != nil {
				return err
			}
		}
	}
	return nil
}

func writeLiveFrame(w http.ResponseWriter, item row) error {
	payloadLength := 8 + 8 + 2 + 2 + len(item.Spectrum) + len(item.Annotations)*5
	if err := binary.Write(w, binary.LittleEndian, uint32(payloadLength)); err != nil {
		return err
	}
	if err := binary.Write(w, binary.LittleEndian, float64(item.Seq)); err != nil {
		return err
	}
	if err := binary.Write(w, binary.LittleEndian, item.TimestampMS); err != nil {
		return err
	}
	if err := binary.Write(w, binary.LittleEndian, uint16(len(item.Spectrum))); err != nil {
		return err
	}
	if err := binary.Write(w, binary.LittleEndian, uint16(len(item.Annotations))); err != nil {
		return err
	}
	if _, err := w.Write(int8Bytes(item.Spectrum)); err != nil {
		return err
	}
	for _, annotation := range item.Annotations {
		if err := binary.Write(w, binary.LittleEndian, annotation.Start); err != nil {
			return err
		}
		if err := binary.Write(w, binary.LittleEndian, annotation.End); err != nil {
			return err
		}
		if _, err := w.Write([]byte{byte(annotation.Value)}); err != nil {
			return err
		}
	}
	return nil
}

func int8Bytes(values []int8) []byte {
	result := make([]byte, len(values))
	for i, value := range values {
		result[i] = byte(value)
	}
	return result
}

func pageRowsFor(binCount int) int {
	target := 1 << 20
	rows := 1
	for rows*2*binCount <= target {
		rows *= 2
	}
	return max(64, min(512, rows))
}

func defaultSignals() []signal {
	return []signal{
		{bin: 60, halfBandwidth: 1, peakDBM: -82}, {bin: 190, halfBandwidth: 2, peakDBM: -71},
		{bin: 320, halfBandwidth: 1, peakDBM: -87}, {bin: 440, halfBandwidth: 1, peakDBM: -76},
		{bin: 580, halfBandwidth: 3, peakDBM: -68}, {bin: 720, halfBandwidth: 1, peakDBM: -80},
		{bin: 850, halfBandwidth: 5, peakDBM: -73}, {bin: 970, halfBandwidth: 1, peakDBM: -84},
		{bin: 1080, halfBandwidth: 2, peakDBM: -70}, {bin: 1200, halfBandwidth: 1, peakDBM: -78},
		{bin: 1340, halfBandwidth: 4, peakDBM: -66}, {bin: 1450, halfBandwidth: 1, peakDBM: -85},
		{bin: 1580, halfBandwidth: 2, peakDBM: -74}, {bin: 1700, halfBandwidth: 1, peakDBM: -81},
		{bin: 1820, halfBandwidth: 3, peakDBM: -69}, {bin: 1940, halfBandwidth: 1, peakDBM: -77},
		{bin: 250, halfBandwidth: 1, peakDBM: -72, active: true, continuous: true},
		{bin: 1750, halfBandwidth: 1, peakDBM: -75, active: true, continuous: true},
	}
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func abs(value int) int {
	if value < 0 {
		return -value
	}
	return value
}
