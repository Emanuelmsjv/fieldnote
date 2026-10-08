import { readFileSync } from "node:fs";

function fourcc(buf, offset) {
  return String.fromCharCode(buf[offset], buf[offset + 1], buf[offset + 2], buf[offset + 3]);
}

function readFormatChunk(buf, offset) {
  const audioFormat = buf.readUInt16LE(offset);
  const numChannels = buf.readUInt16LE(offset + 2);
  const sampleRate = buf.readUInt32LE(offset + 4);
  const bitsPerSample = buf.readUInt16LE(offset + 14);

  let format = audioFormat;
  let bits = bitsPerSample;

  if (audioFormat === 0xfffe && buf.length >= offset + 40) {
    const validBits = buf.readUInt16LE(offset + 18);
    const subFormatFirst = buf.readUInt16LE(offset + 24);
    format = subFormatFirst;
    bits = validBits || bitsPerSample;
  }

  return { format, numChannels, sampleRate, bits };
}

function readSamples(buf, offset, length, { format, numChannels, bits }) {
  const bytesPerSample = bits / 8;
  const totalSamples = Math.floor(length / bytesPerSample);
  const frames = Math.floor(totalSamples / numChannels);
  const out = new Float32Array(frames);

  for (let f = 0; f < frames; f += 1) {
    let acc = 0;
    for (let c = 0; c < numChannels; c += 1) {
      const pos = offset + (f * numChannels + c) * bytesPerSample;
      if (format === 3) {
        acc += bits === 64 ? buf.readDoubleLE(pos) : buf.readFloatLE(pos);
      } else if (bits === 8) {
        acc += (buf.readUInt8(pos) - 128) / 128;
      } else if (bits === 16) {
        acc += buf.readInt16LE(pos) / 32768;
      } else if (bits === 24) {
        const b0 = buf.readUInt8(pos);
        const b1 = buf.readUInt8(pos + 1);
        const b2 = buf.readUInt8(pos + 2);
        let v = (b2 << 16) | (b1 << 8) | b0;
        if (v & 0x800000) v -= 0x1000000;
        acc += v / 8388608;
      } else if (bits === 32) {
        acc += buf.readInt32LE(pos) / 2147483648;
      } else {
        throw new Error(`unsupported bit depth ${bits}`);
      }
    }
    out[f] = acc / numChannels;
  }

  return out;
}

export function decodeWav(filePath) {
  const buf = readFileSync(filePath);

  if (fourcc(buf, 0) !== "RIFF" || fourcc(buf, 8) !== "WAVE") {
    throw new Error("not a RIFF/WAVE file");
  }

  let offset = 12;
  let fmt = null;
  let data = null;

  while (offset + 8 <= buf.length) {
    const id = fourcc(buf, offset);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;

    if (id === "fmt ") fmt = readFormatChunk(buf, body);
    else if (id === "data") {
      data = readSamples(buf, body, Math.min(size, buf.length - body), fmt ?? {});
      break;
    }

    offset = body + size + (size % 2);
  }

  if (!fmt) throw new Error("no fmt chunk found");
  if (!data) throw new Error("no data chunk found");

  return { samples: data, sampleRate: fmt.sampleRate };
}

export function resampleLinear(input, srcRate, dstRate) {
  if (srcRate === dstRate) return input;
  const ratio = srcRate / dstRate;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i += 1) {
    const srcPos = i * ratio;
    const idx = Math.floor(srcPos);
    const frac = srcPos - idx;
    const s0 = input[idx] ?? 0;
    const s1 = input[idx + 1] ?? s0;
    out[i] = s0 + (s1 - s0) * frac;
  }
  return out;
}

export function normalize(samples) {
  let peak = 0;
  for (const s of samples) {
    const a = Math.abs(s);
    if (a > peak) peak = a;
  }
  if (peak > 0 && peak < 0.99) {
    const gain = 0.99 / peak;
    for (let i = 0; i < samples.length; i += 1) samples[i] *= gain;
  }
  return samples;
}

export function toMonoAt(samples, srcRate, targetRate) {
  return normalize(resampleLinear(samples, srcRate, targetRate));
}
