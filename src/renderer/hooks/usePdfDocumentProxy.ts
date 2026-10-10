import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
// `?url` gives a URL Vite actually emitted, resolved against document.baseURI.
// `import.meta.url` is not reliable inside a bundled ESM served over app://.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(workerUrl, document.baseURI).toString();

/**
 * Feeds pdf.js byte ranges over IPC.
 *
 * pdf.js only issues HTTP range requests when the source URL is http(s)
 * (`this.isHttp = /^https?:/i.test(source.url)` in pdf.mjs, then
 * `if (disableRange || !isHttp) allowRangeRequests = false`). A custom lbook://
 * URL therefore makes it download the *entire* book into renderer memory —
 * 189 MB for the largest book here. PDFDataRangeTransport bypasses that check
 * completely, which is why the PDF never travels over a URL.
 */
class IpcRangeTransport extends pdfjsLib.PDFDataRangeTransport {
  private aborted = false;
  private readonly bookId: string;
  private readonly byteLength: number;
  private readonly onError: (error: Error) => void;

  constructor(bookId: string, length: number, onError: (error: Error) => void) {
    super(length, null);
    this.bookId = bookId;
    this.byteLength = length;
    this.onError = onError;
  }

  /**
   * `end` is EXCLUSIVE here — pdf.js recomputes it as
   * `begin + chunk.byteLength` and rejects the chunk unless that lands on a
   * chunk boundary or exactly on the end of the file
   * (ChunkedStream.onReceiveData, "Bad end offset"). The IPC call is inclusive,
   * so subtract one: returning one byte too many is enough to break every page.
   */
  requestDataRange(begin: number, end: number): void {
    const lastByte = Math.min(end, this.byteLength) - 1;
    if (lastByte < begin) return;

    void window.api.book
      .readPdfRange(this.bookId, begin, lastByte)
      .then((chunk) => {
        if (!this.aborted) this.onDataRange(begin, chunk);
      })
      .catch((error: unknown) => {
        if (!this.aborted) {
          this.onError(error instanceof Error ? error : new Error(String(error)));
        }
      });
  }

  abort(): void {
    this.aborted = true;
  }
}

export function usePdfDocumentProxy(bookId: string): {
  pdfDoc: pdfjsLib.PDFDocumentProxy | null;
  loading: boolean;
  error: string | null;
} {
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);

  useEffect(() => {
    let cancelled = false;
    let transport: IpcRangeTransport | null = null;
    let loadingTask: pdfjsLib.PDFDocumentLoadingTask | null = null;

    setLoading(true);
    setError(null);
    setPdfDoc(null);
    pdfDocRef.current = null;

    void (async () => {
      try {
        const document = await window.api.library.get(bookId);
        if (cancelled) return;
        if (!document) throw new Error("This book is no longer in the library.");

        // The transport must be given the exact byte length of book.pdf up
        // front; a wrong length surfaces as "Invalid PDF structure".
        transport = new IpcRangeTransport(bookId, document.file_size, (transportError) => {
          if (!cancelled) {
            setError(transportError.message);
            setLoading(false);
          }
        });

        // 512KB per range request, not 64KB.
        //
        // pdf.js pulls the document through this transport in `rangeChunkSize`
        // chunks and every chunk is its own async round trip (measured: ~0.5ms per
        // 64KB, ~3.3ms per 1MB, so the pipe moves ~300MB/s either way). What costs
        // is the *number* of round trips — a 178MB book is ~2850 of them at 64KB —
        // and the worker cannot paint a page until its chunks have arrived.
        //
        // `disableAutoFetch` is deliberately NOT set. Turning it on looks like the
        // obvious win (it stops the whole file streaming into the worker), but
        // measured on the 178MB book it made steady-state flips *slower*: median
        // first paint 90ms versus 60ms, p90 120ms versus 87ms, because every flip
        // then waits for on-demand chunks. Auto-fetch keeps the file local and
        // flips fast; the price is the whole document sitting in the worker, which
        // is the thing to revisit if memory ever becomes the complaint. (pdf.js's
        // `PDFDataTransportStream` only takes disableRange/disableStream — with a
        // custom range transport, `disableAutoFetch` is honoured further in, by the
        // worker's ChunkedStreamManager, so it does take effect.)
        loadingTask = pdfjsLib.getDocument({ range: transport, rangeChunkSize: 1 << 19 });
        const loaded = await loadingTask.promise;

        if (cancelled) {
          loaded.cleanup();
          return;
        }
        pdfDocRef.current = loaded;
        setPdfDoc(loaded);
        setLoading(false);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      transport?.abort();
      void loadingTask?.destroy();
      if (pdfDocRef.current) {
        void pdfDocRef.current.cleanup();
        pdfDocRef.current = null;
      }
    };
  }, [bookId]);

  return { pdfDoc, loading, error };
}
