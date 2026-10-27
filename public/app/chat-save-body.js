// Lossless transport only: native chat shape, unknown fields and integrity are
// unchanged. Browsers without CompressionStream keep the ordinary JSON path.
export async function prepareChatSaveBody(json, { compress = true, threshold = 262144, Compression = globalThis.CompressionStream } = {}) {
    const source = new Blob([json], { type: 'application/json' });
    const metrics = { payloadBytes: source.size, transferBytes: source.size, gzip: 0, compressionFallback: 0 };
    if (compress && source.size >= threshold && Compression) {
        try {
            const bytes = await new Response(source.stream().pipeThrough(new Compression('gzip'))).arrayBuffer();
            if (bytes.byteLength < source.size * .9) return { body: bytes, plainBody: json, metrics: { ...metrics, transferBytes: bytes.byteLength, gzip: 1 } };
        } catch { metrics.compressionFallback = 1; }
    }
    return { body: json, plainBody: json, metrics };
}
