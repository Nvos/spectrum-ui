package main

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPageRowsForUsesPowerOfTwoByteBudget(t *testing.T) {
	tests := []struct {
		bins int
		want int
	}{{64, 512}, {2_000, 512}, {4_000, 256}, {8_192, 128}}
	for _, test := range tests {
		if got := pageRowsFor(test.bins); got != test.want {
			t.Fatalf("pageRowsFor(%d) = %d, want %d", test.bins, got, test.want)
		}
	}
}

func TestMetadataAndHistoryPageShareSequenceSpace(t *testing.T) {
	c := newCapture(captureConfig{FreqStart: 25_000, Resolution: 1_500, BinCount: 64})
	s := &server{current: c}

	metadataRequest := httptest.NewRequest(http.MethodGet, "/api/captures/current", nil)
	metadataResponse := httptest.NewRecorder()
	s.routes().ServeHTTP(metadataResponse, metadataRequest)
	if metadataResponse.Code != http.StatusOK {
		t.Fatalf("metadata status = %d", metadataResponse.Code)
	}
	var gotMetadata metadata
	if err := json.Unmarshal(metadataResponse.Body.Bytes(), &gotMetadata); err != nil {
		t.Fatal(err)
	}

	pageIndex := gotMetadata.SeqEnd/uint64(gotMetadata.PageRows) - 1
	pageURL := "/api/captures/" + gotMetadata.SessionID + "/pages?from=" + uintToString(pageIndex) + "&count=1"
	pageRequest := httptest.NewRequest(http.MethodGet, pageURL, nil)
	pageRequest.SetPathValue("sessionID", gotMetadata.SessionID)
	pageResponse := httptest.NewRecorder()
	s.routes().ServeHTTP(pageResponse, pageRequest)
	if pageResponse.Code != http.StatusOK {
		t.Fatalf("page status = %d: %s", pageResponse.Code, pageResponse.Body.String())
	}

	body := bytes.NewReader(pageResponse.Body.Bytes())
	var headerLength uint32
	if err := binary.Read(body, binary.LittleEndian, &headerLength); err != nil {
		t.Fatal(err)
	}
	headerBytes := make([]byte, headerLength)
	if _, err := body.Read(headerBytes); err != nil {
		t.Fatal(err)
	}
	var header pageHeader
	if err := json.Unmarshal(headerBytes, &header); err != nil {
		t.Fatal(err)
	}
	wantStart := pageIndex * uint64(gotMetadata.PageRows)
	if header.SeqStart != wantStart {
		t.Fatalf("page seqStart = %d, want %d", header.SeqStart, wantStart)
	}
	if header.BinCount != gotMetadata.BinCount || header.Rows != gotMetadata.PageRows {
		t.Fatalf("page shape = %dx%d, metadata = %dx%d", header.Rows, header.BinCount, gotMetadata.PageRows, gotMetadata.BinCount)
	}
}

func uintToString(value uint64) string {
	if value == 0 {
		return "0"
	}
	var digits [20]byte
	i := len(digits)
	for value > 0 {
		i--
		digits[i] = byte('0' + value%10)
		value /= 10
	}
	return string(digits[i:])
}
