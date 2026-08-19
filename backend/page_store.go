package main

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
)

const maxPageRecordBytes = 64 << 20

type pageLocation struct {
	segment int
	offset  int64
	length  uint32
}

// pageStore is an append-only sequence of immutable page payloads. Segment files
// contain [uint32 payload length][payload] records. The in-memory index can be
// rebuilt by scanning the files, and an incomplete final record is discarded on
// open so a process interruption cannot expose a partial page.
type pageStore struct {
	mu              sync.RWMutex
	dir             string
	maxSegmentBytes int64
	files           []*os.File
	locations       []pageLocation
	currentSize     int64
	closed          bool
}

func openPageStore(dir string, maxSegmentBytes int64) (*pageStore, error) {
	if maxSegmentBytes <= 0 {
		return nil, errors.New("max segment size must be positive")
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("create page store: %w", err)
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("read page store: %w", err)
	}
	segmentNumbers := make([]int, 0)
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if !strings.HasPrefix(name, "segment-") || !strings.HasSuffix(name, ".dat") {
			continue
		}
		raw := strings.TrimSuffix(strings.TrimPrefix(name, "segment-"), ".dat")
		number, err := strconv.Atoi(raw)
		if err != nil || number < 0 {
			continue
		}
		segmentNumbers = append(segmentNumbers, number)
	}
	sort.Ints(segmentNumbers)

	store := &pageStore{dir: dir, maxSegmentBytes: maxSegmentBytes}
	if len(segmentNumbers) == 0 {
		if err := store.createSegment(0); err != nil {
			return nil, err
		}
		return store, nil
	}

	for position, number := range segmentNumbers {
		if number != position {
			store.closeFiles()
			return nil, fmt.Errorf("page store segment sequence has a gap before %06d", number)
		}
		path := filepath.Join(dir, segmentFilename(number))
		file, err := os.OpenFile(path, os.O_RDWR, 0o644)
		if err != nil {
			store.closeFiles()
			return nil, fmt.Errorf("open page store segment: %w", err)
		}
		store.files = append(store.files, file)
		isLast := position == len(segmentNumbers)-1
		size, err := store.scanSegment(number, file, isLast)
		if err != nil {
			store.closeFiles()
			return nil, err
		}
		if isLast {
			store.currentSize = size
			if _, err := file.Seek(size, io.SeekStart); err != nil {
				store.closeFiles()
				return nil, fmt.Errorf("seek page store tail: %w", err)
			}
		}
	}
	return store, nil
}

func (s *pageStore) scanSegment(segment int, file *os.File, allowTailRepair bool) (int64, error) {
	info, err := file.Stat()
	if err != nil {
		return 0, fmt.Errorf("stat page store segment: %w", err)
	}
	size := info.Size()
	offset := int64(0)
	var lengthBytes [4]byte
	for offset < size {
		if size-offset < int64(len(lengthBytes)) {
			return s.repairTail(file, offset, allowTailRepair)
		}
		if _, err := file.ReadAt(lengthBytes[:], offset); err != nil {
			return 0, fmt.Errorf("read page record length: %w", err)
		}
		length := binary.LittleEndian.Uint32(lengthBytes[:])
		if length == 0 || length > maxPageRecordBytes {
			return 0, fmt.Errorf("invalid page record length %d in segment %06d", length, segment)
		}
		recordEnd := offset + 4 + int64(length)
		if recordEnd > size {
			return s.repairTail(file, offset, allowTailRepair)
		}
		s.locations = append(s.locations, pageLocation{segment: segment, offset: offset + 4, length: length})
		offset = recordEnd
	}
	return size, nil
}

func (s *pageStore) repairTail(file *os.File, validSize int64, allowed bool) (int64, error) {
	if !allowed {
		return 0, errors.New("incomplete page record before final segment")
	}
	if err := file.Truncate(validSize); err != nil {
		return 0, fmt.Errorf("truncate incomplete page record: %w", err)
	}
	if _, err := file.Seek(validSize, io.SeekStart); err != nil {
		return 0, fmt.Errorf("seek repaired page store: %w", err)
	}
	return validSize, nil
}

func (s *pageStore) Append(payload []byte) error {
	if len(payload) == 0 || len(payload) > maxPageRecordBytes {
		return fmt.Errorf("page payload size %d is invalid", len(payload))
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return errors.New("page store is closed")
	}
	recordSize := int64(4 + len(payload))
	if s.currentSize > 0 && s.currentSize+recordSize > s.maxSegmentBytes {
		if err := s.createSegment(len(s.files)); err != nil {
			return err
		}
	}

	file := s.files[len(s.files)-1]
	recordStart := s.currentSize
	var lengthBytes [4]byte
	binary.LittleEndian.PutUint32(lengthBytes[:], uint32(len(payload)))
	if err := writeAll(file, lengthBytes[:]); err != nil {
		return s.rollbackAppend(file, recordStart, err)
	}
	if err := writeAll(file, payload); err != nil {
		return s.rollbackAppend(file, recordStart, err)
	}
	if err := file.Sync(); err != nil {
		return s.rollbackAppend(file, recordStart, err)
	}

	segment := len(s.files) - 1
	s.locations = append(s.locations, pageLocation{segment: segment, offset: recordStart + 4, length: uint32(len(payload))})
	s.currentSize += recordSize
	return nil
}

func (s *pageStore) rollbackAppend(file *os.File, recordStart int64, cause error) error {
	if err := file.Truncate(recordStart); err != nil {
		return fmt.Errorf("append page: %v; rollback: %w", cause, err)
	}
	_, _ = file.Seek(recordStart, io.SeekStart)
	return fmt.Errorf("append page: %w", cause)
}

func (s *pageStore) ReadPage(index uint64) ([]byte, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.closed {
		return nil, errors.New("page store is closed")
	}
	if index >= uint64(len(s.locations)) {
		return nil, os.ErrNotExist
	}
	location := s.locations[index]
	payload := make([]byte, int(location.length))
	if _, err := s.files[location.segment].ReadAt(payload, location.offset); err != nil {
		return nil, fmt.Errorf("read page %d: %w", index, err)
	}
	return payload, nil
}

func (s *pageStore) ReadPageRange(index uint64, offset, length int64) ([]byte, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.closed {
		return nil, errors.New("page store is closed")
	}
	if index >= uint64(len(s.locations)) {
		return nil, os.ErrNotExist
	}
	location := s.locations[index]
	if offset < 0 || length < 0 || offset > int64(location.length) || length > int64(location.length)-offset {
		return nil, errors.New("page range is outside the payload")
	}
	payload := make([]byte, int(length))
	if _, err := s.files[location.segment].ReadAt(payload, location.offset+offset); err != nil {
		return nil, fmt.Errorf("read page %d range: %w", index, err)
	}
	return payload, nil
}

func (s *pageStore) PageCount() uint64 {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return uint64(len(s.locations))
}

func (s *pageStore) SegmentNames() []string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	names := make([]string, len(s.files))
	for index := range names {
		names[index] = segmentFilename(index)
	}
	return names
}

func (s *pageStore) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return nil
	}
	s.closed = true
	return s.closeFiles()
}

func (s *pageStore) createSegment(number int) error {
	path := filepath.Join(s.dir, segmentFilename(number))
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0o644)
	if err != nil {
		return fmt.Errorf("create page store segment: %w", err)
	}
	s.files = append(s.files, file)
	s.currentSize = 0
	return nil
}

func (s *pageStore) closeFiles() error {
	var firstErr error
	for _, file := range s.files {
		if err := file.Close(); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

func segmentFilename(number int) string {
	return fmt.Sprintf("segment-%06d.dat", number)
}

func writeAll(w io.Writer, payload []byte) error {
	for len(payload) > 0 {
		written, err := w.Write(payload)
		if err != nil {
			return err
		}
		if written == 0 {
			return io.ErrShortWrite
		}
		payload = payload[written:]
	}
	return nil
}
