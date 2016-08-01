```javascript
var AppendStream = require('stream-to-blob-log')
```

Ideally, you'd write every blob-log file in batches, appending CRC-32,
length, and bits for each blob to the file.  That means having blobs,
CRC-32s, and blob lengths in memory.

This package exports a `Writable` stream that writes a single blob
to a blob-log file at a given file path.  Depending on the arguments
passed, that involves either:

1. a single, sequential, appending write of CRC-32, blob length,
   and blob bytes:

   ```javascript
   blobData.pipe(new AppendStream('existing.log', crc, length))
   ```

   This incurs the same disk performance penalty of appending a
   single blob from memory, without loading the entire blob into
   memory at one time.  If you're dealing with the file system or a
   (non-chunked) HTTP request, you may be able to learn the length
   of a blob without iteration.  Precomputed CRC-32s are less common.

2. a sequential, appending write of a zero-filled placeholder for
   CRC-32 and length prefix, followed by blob bytes, and then another,
   short write of 64 bits to replace the zero-filled prefix with
   CRC-32 and length calculated while appending:

   ```javascript
   blobData.pipe(new AppendStream('existing.log'))
   ```

   This approach trades single-write, append-only disk access for
   a single iteration of the blob data stream.  That may make sense
   for applications with few blobs to write per unit time and many
   bytes per blob.

In either case, the `finish` event is emitted only once all blob
bytes _and_ a correct blob prefix have been written to disk.  Up to
that point, a blob-log decoder will see an invalid, zero-length prefix.
