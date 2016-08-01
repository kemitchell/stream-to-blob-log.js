var AppendStream = require('./')
var Decoder = require('blob-log-decoder')
var Encoder = require('blob-log-encoder')
var from2Array = require('from2-array')
var fs = require('fs')
var mkdtempd = require('temporary-directory')
var noisegen = require('noisegen')
var path = require('path')
var tape = require('tape')
var touch = require('touch')

tape('without prefix', function (test) {
  mkdtempd(function (error, directory, cleanUp) {
    test.ifError(error, 'no error')
    var file = path.join(directory, 'test.log')
    var encoder = new Encoder(1)
    encoder.pipe(fs.createWriteStream(file))
    .once('finish', function () {
      // Stream a long blob of random bytes.
      noisegen({
        length: 4096,
        size: 256
      })
      .pipe(
        new AppendStream(file)
        .once('finish', function () {
          var buffer = []
          fs.createReadStream(file)
          .pipe(new Decoder())
          .on('data', function (blob) {
            buffer.push(blob)
          })
          .once('error', /* istanbul ignore next */ function (error) {
            test.fail(error)
            finish()
          })
          .once('end', function () {
            test.equal(buffer.length, 2, 'read 2')
            finish()
          })
        })
      )
    })
    encoder.end(new Buffer('blah blah blah', 'ascii'))
    function finish () {
      cleanUp()
      test.end()
    }
  })
})

var CRC_OF_4096_ZERO_BYTES = 3340501009

tape('with prefix', function (test) {
  mkdtempd(function (error, directory, cleanUp) {
    test.ifError(error, 'no error')
    var file = path.join(directory, 'test.log')
    var encoder = new Encoder(1)
    encoder.pipe(fs.createWriteStream(file))
    .once('finish', function () {
      var chunks = []
      while (chunks.length < (4096 / 512)) {
        chunks.push(new Buffer(512).fill(0))
      }
      from2Array(chunks)
      .pipe(
        AppendStream(file, CRC_OF_4096_ZERO_BYTES, 4096)
        .once('finish', function () {
          var buffer = []
          fs.createReadStream(file)
          .pipe(new Decoder())
          .on('data', function (blob) {
            buffer.push(blob)
          })
          .once('error', /* istanbul ignore next */ function (error) {
            test.fail(error)
            finish()
          })
          .once('end', function () {
            test.equal(buffer.length, 2, 'read 2')
            finish()
          })
        })
      )
    })
    encoder.end(new Buffer('blah blah blah', 'ascii'))
    function finish () {
      cleanUp()
      test.end()
    }
  })
})

tape('invalid CRC-32', function (test) {
  test.throws(function () {
    AppendStream('test.log', 4294967295 + 1, 1)
  }, /invalid CRC-32/)
  test.end()
})

tape('invalid blob length', function (test) {
  test.throws(function () {
    AppendStream('test.log', 1, 0)
  }, /invalid length/)
  test.end()
})

tape('nonexistent log file', function (test) {
  mkdtempd(function (error, directory, cleanUp) {
    test.ifError(error, 'no error')
    var file = path.join(directory, 'test.log')
    AppendStream(file, CRC_OF_4096_ZERO_BYTES, 4096)
    .once('error', function (error) {
      test.equal(error.code, 'ENOENT')
      cleanUp()
      test.end()
    })
  })
})

tape('nonexistent log file', function (test) {
  mkdtempd(function (error, directory, cleanUp) {
    test.ifError(error, 'no error')
    var file = path.join(directory, 'test.log')
    touch(file, function () {
      AppendStream(file)
      .once('error', function (error) {
        test.equal(error.noSequenceNumber, true)
        cleanUp()
        test.end()
      })
    })
  })
})
