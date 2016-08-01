var EventEmitter = require('events').EventEmitter
var Writable = require('readable-stream').Writable
var createHash = require('crc-hash').createHash
var fs = require('fs')
var inherits = require('util').inherits

var CRC_BYTES = 4 // Length of a CRC-32, in bytes
var LENGTH_BYTES = 4 // Bytes for blob length

function WriteStream () {
  var self = this
  var arity = arguments.length
  var path
  // Given just a file path, must:
  // 1. Write a zero-filled placeholder CRC-32 and length prefix.
  // 2. Stream blob bytes to the file after the placeholder prefix,
  //    counting length and calculating CRC-32 as bytes stream through.
  // 3. Before emitting `finish`, open another write stream to overwrite
  //    the placeholder prefix with the calculated CRC-32 and length.
  if (arity === 1) {
    path = self._path = arguments[0]
    self._givenPrefix = false
    self._length = 0
    self._CRC = createHash('crc32')
  // Given file path, CRC-32, and length, must:
  // 1. Append the CRC-32 and length to the file.
  // 2. Stream blob bytes to the file after the prefix.
  } else {
    self._givenPrefix = true
    path = self._path = arguments[0]
    var crc = self._CRC = arguments[1]
    if (!isValidUInt32(crc)) {
      throw new Error('invalid CRC-32')
    }
    var length = self._length = arguments[2]
    if (!isValidLength(length)) {
      throw new Error('invalid length')
    }
  }

  // Expose a Writable interface.
  Writable.call(self)

  // State the file path to get its current size.  This is the offset
  // where we will write the CRC-32 and length prefix.
  fs.stat(path, function (error, stats) {
    if (error) {
      self.emit('error', error)
    } else {
      // If the file is empty or doesn't exist, it doesn't have a
      // first-sequence-number value written.  If we append without
      // that initial value, it won't be a complete blob-log file.
      if (!stats.isFile() || stats.size === 0) {
        throw new Error(
          'cannot append to file without first sequence number'
        )
      // Save the current size as the offset we'll start at later if we
      // need to overwrite a zero-filled CRC-32 and length prefix.
      } else {
        self._offset = stats.size
      }

      // Create a write stream to append to the file.
      var appendStream = fs.createWriteStream(path, {flags: 'a'})
      self._appendStream = appendStream

      // If we were given CRC-32 and length values ahead of time, append
      // them.  Otherwise, append a zero-filled placeholder.
      if (this._givenPrefix) {
        self.write(self._crc, self._length)
      } else {
        // Note that zero is a valid CRC-32, but not a valid blob
        // length.  Until we overwrite the length integer, a blob-log
        // parser can tell this append wasn't completed.
        self.write(self._prefix(0, 0))
      }
    }
  })
}

inherits(WriteStream, Writable)

var prototype = WriteStream.prototype

// Create a buffer containing bytes for a CRC-32 and blob length prefix.
prototype._prefix = function (crc, length) {
  var prefix = new Buffer(CRC_BYTES + LENGTH_BYTES)
  prefix.writeUInt32BE(crc)
  prefix.writeUInt32BE(length, CRC_BYTES)
  return prefix
}

// Override the standard `EventEmitter` emit function to postpone
// calling listeners to the `finish` event until we've overwritten any
// placeholder blob prefix with actual CRC-32 and length.
prototype.emit = function (event) {
  var self = this
  var argumentsArray = Array.prototype.slice.call(arguments)
  // If we are calculating CRC-32 and length and emitting a `finish`...
  if (!self._givenPrefix && event === 'finish') {
    var prefix = self._prefix(
      self._crc.digest().readUInt32BE(),
      self._length
    )
    fs.createWriteStream(self._path, {start: self._offset})
    .end(prefix, function () {
      EventEmitter.prototype.emit.apply(self, argumentsArray)
    })
  // Emit any other event as usual.
  } else {
    EventEmitter.prototype.emit.apply(self, argumentsArray)
  }
}

prototype._write = function (chunk, encoding, callback) {
  var self = this
  // If we weren't given a CRC-32 and length to begin with...
  if (!self._givenPrefix) {
    self._CRC.update(chunk)
    self._length += chunk.length
  }
  // Proxy the underlying file append stream.
  var readyForMore = self._appendStream.write(chunk, encoding, callback)
  if (readyForMore === false) {
    self._appendStream.once('drain', function () {
      self.emit('drain')
    })
  }
  return readyForMore
}

// Blob lengths, unlike CRC-32 values, cannot be zero.
function isValidLength (argument) {
  return isValidUInt32(argument) && argument !== 0
}

function isValidUInt32 (argument) {
  return (
    Number.isInteger(argument) &&
    argument >= 0 &&
    argument <= 2147483647
  )
}
