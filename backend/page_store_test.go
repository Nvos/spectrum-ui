package main

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestPageStoreRotatesReopensAndAppends(t *testing.T) {
	dir := t.TempDir()
	store, err := openPageStore(dir, 14)
	if err != nil {
		t.Fatal(err)
	}
	want := [][]byte{[]byte("first"), []byte("second"), []byte("third")}
	for _, payload := range want {
		if err := store.Append(payload); err != nil {
			t.Fatal(err)
		}
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 3 {
		t.Fatalf("segment count = %d, want 3", len(entries))
	}

	store, err = openPageStore(dir, 14)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if store.PageCount() != uint64(len(want)) {
		t.Fatalf("page count = %d, want %d", store.PageCount(), len(want))
	}
	for index, expected := range want {
		got, err := store.ReadPage(uint64(index))
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(got, expected) {
			t.Fatalf("page %d = %q, want %q", index, got, expected)
		}
	}
	if err := store.Append([]byte("fourth")); err != nil {
		t.Fatal(err)
	}
	got, err := store.ReadPage(3)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "fourth" {
		t.Fatalf("appended page = %q, want fourth", got)
	}
}

func TestPageStoreRepairsIncompleteFinalRecord(t *testing.T) {
	dir := t.TempDir()
	store, err := openPageStore(dir, 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Append([]byte("complete")); err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}

	path := filepath.Join(dir, segmentFilename(0))
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.Write([]byte{10, 0}); err != nil {
		file.Close()
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}

	store, err = openPageStore(dir, 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if store.PageCount() != 1 {
		t.Fatalf("page count after repair = %d, want 1", store.PageCount())
	}
	if err := store.Append([]byte("after-repair")); err != nil {
		t.Fatal(err)
	}
	got, err := store.ReadPage(1)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "after-repair" {
		t.Fatalf("page after repair = %q", got)
	}
}
