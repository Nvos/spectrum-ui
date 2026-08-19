package main

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"math"
	"math/rand/v2"
	"net/http"
	"strconv"
	"sync"
	"time"
)

const (
	defaultAddress       = "127.0.0.1:8787"
	defaultFrequency     = 25_000
	defaultResolution    = 1_500
	defaultBinCount      = 4_000
	defaultRetentionRows = 16_384
	initialRows          = 1_024
	tickInterval         = 60 * time.Millisecond
	occupancyThreshold   = -85
	powerNoReading       = -128
	maxBatchPages        = 8
)

type captureConfig struct {
	FreqStart   int64 `json:"freqStart"`
	Resolution  int64 `json:"resolution"`
	BinCount    int   `json:"binCount"`
	HistoryRows int   `json:"historyRows,omitempty"`
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
	retentionRows int
	startedAt     int64
	seqStart      uint64
	seqEnd        uint64
	rows          []row
	subscribers   map[chan row]struct{}
	signals       []signal
	cancel        context.CancelFunc
}

type server struct {
	mu      sync.RWMutex
	current *capture
}

func main() {
	address := flag.String("addr", defaultAddress, "HTTP listen address")
	flag.Parse()

	s := &server{}
	s.replaceCapture(captureConfig{FreqStart: defaultFrequency, Resolution: defaultResolution, BinCount: defaultBinCount})

	httpServer := &http.Server{
		Addr:              *address,
		Handler:           s.routes(),
		ReadHeaderTimeout: 5 * time.Second,
	}
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
	if cfg.HistoryRows < 512 || cfg.HistoryRows > 8_192 || cfg.HistoryRows&(cfg.HistoryRows-1) != 0 {
		writeError(w, http.StatusBadRequest, "historyRows must be a power of two between 512 and 8192")
		return
	}
	c := s.replaceCapture(cfg)
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

	pages, status := c.pages(from, count)
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
	w.Header().Set("ETag", fmt.Sprintf("\"%s/p/%d/%d\"", c.id, from, count))
	for _, page := range pages {
		if err := writePage(w, page, c.config.BinCount); err != nil {
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
	timestamp, err := strconv.ParseInt(r.URL.Query().Get("t"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "t must be epoch milliseconds")
		return
	}
	seq, found := c.seek(timestamp)
	if !found {
		writeError(w, http.StatusNotFound, "capture has no rows")
		return
	}
	writeJSON(w, http.StatusOK, map[string]uint64{"seq": seq})
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

func (s *server) replaceCapture(cfg captureConfig) *capture {
	c := newCapture(cfg)
	s.mu.Lock()
	previous := s.current
	s.current = c
	s.mu.Unlock()
	if previous != nil {
		previous.stop()
	}
	c.start()
	return c
}

func newCapture(cfg captureConfig) *capture {
	if cfg.HistoryRows <= 0 {
		cfg.HistoryRows = 4_096
	}
	pageRows := pageRowsFor(cfg.BinCount)
	now := time.Now()
	c := &capture{
		id:            fmt.Sprintf("cap_%x", now.UnixNano()),
		config:        cfg,
		pageRows:      pageRows,
		retentionRows: max(defaultRetentionRows, cfg.HistoryRows*2),
		startedAt:     now.UnixMilli() - int64(initialRows-1)*tickInterval.Milliseconds(),
		rows:          make([]row, max(defaultRetentionRows, cfg.HistoryRows*2)),
		subscribers:   make(map[chan row]struct{}),
		signals:       defaultSignals(),
		cancel:        func() {},
	}
	for i := 0; i < initialRows; i++ {
		timestamp := now.Add(-time.Duration(initialRows-1-i) * tickInterval)
		c.appendGenerated(timestamp)
	}
	return c
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
				c.appendGenerated(now)
			}
		}
	}()
}

func (c *capture) stop() {
	c.cancel()
	c.mu.Lock()
	defer c.mu.Unlock()
	for subscriber := range c.subscribers {
		close(subscriber)
		delete(c.subscribers, subscriber)
	}
}

func (c *capture) appendGenerated(timestamp time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	item := c.generateRow(timestamp)
	slot := item.Seq % uint64(c.retentionRows)
	c.rows[slot] = item
	c.seqEnd++
	if c.seqEnd-c.seqStart > uint64(c.retentionRows) {
		c.seqStart = c.seqEnd - uint64(c.retentionRows)
	}
	for subscriber := range c.subscribers {
		select {
		case subscriber <- item:
		default:
			close(subscriber)
			delete(c.subscribers, subscriber)
		}
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
		StartedAt: c.startedAt, Retention: retention{Rows: c.retentionRows, Policy: "ring"},
		LiveFormat: "spectrum-live-binary-v1",
	}
}

func (c *capture) pages(from uint64, count int) ([][]row, int) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	start := from * uint64(c.pageRows)
	end := start + uint64(count*c.pageRows)
	completeEnd := c.seqEnd - c.seqEnd%uint64(c.pageRows)
	if start < c.seqStart {
		return nil, http.StatusGone
	}
	if end > completeEnd {
		return nil, http.StatusNotFound
	}
	pages := make([][]row, count)
	for p := 0; p < count; p++ {
		pages[p] = make([]row, c.pageRows)
		for i := 0; i < c.pageRows; i++ {
			seq := start + uint64(p*c.pageRows+i)
			pages[p][i] = c.rows[seq%uint64(c.retentionRows)]
		}
	}
	return pages, http.StatusOK
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
		if int64(c.rows[mid%uint64(c.retentionRows)].TimestampMS) < timestamp {
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
		if after+1 < c.seqStart {
			return nil, nil, func() {}, http.StatusGone
		}
		start = after + 1
	}
	backlog := make([]row, 0, c.seqEnd-start)
	for seq := start; seq < c.seqEnd; seq++ {
		backlog = append(backlog, c.rows[seq%uint64(c.retentionRows)])
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

func writePage(w http.ResponseWriter, rows []row, binCount int) error {
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
