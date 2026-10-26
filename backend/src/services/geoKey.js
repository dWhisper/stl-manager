// Mesh fingerprint for "same model, different file" duplicate detection.
// Built-ins only (no sharp) so it loads anywhere; stlRender.js imports this, not the reverse.
// Key = triangle count + sorted bbox sides + surface area + volume, each at 3 s.f.,
// so it survives rotation by 90 degrees, translation and re-export, but not scaling.

const sig = x => String(Number(x.toPrecision(3)));

// Returns the geo key for an STL buffer, or null when it has no triangles.
export function geoKeyFromStl(buf) {
  const acc = {
    n: 0, area: 0, vol: 0,
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  };

  // Same binary-vs-ASCII test as parseSTL: binary files can start with "solid",
  // so trust the declared count when the file is big enough to hold it
  const declared = buf.length >= 84 ? buf.readUInt32LE(80) : 0;
  if (declared > 0 && 84 + declared * 50 <= buf.length) {
    for (let i = 0; i < declared; i++) {
      const o = 84 + i * 50 + 12;
      addTriangle(acc,
        buf.readFloatLE(o),    buf.readFloatLE(o+4),  buf.readFloatLE(o+8),
        buf.readFloatLE(o+12), buf.readFloatLE(o+16), buf.readFloatLE(o+20),
        buf.readFloatLE(o+24), buf.readFloatLE(o+28), buf.readFloatLE(o+32));
    }
  } else {
    // Unlike the renderer, no size cap: the fingerprint must see the whole mesh
    const VR = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g;
    const text = buf.toString('ascii');
    const v = [];
    let m;
    while ((m = VR.exec(text))) {
      v.push(+m[1], +m[2], +m[3]);
      if (v.length === 9) { addTriangle(acc, ...v); v.length = 0; }
    }
  }

  if (acc.n === 0) return null;
  const sides = acc.max.map((hi, k) => hi - acc.min[k]).sort((a, b) => a - b);
  return `t${sig(acc.n)}|b${sides.map(sig).join(',')}|a${sig(acc.area)}|v${sig(Math.abs(acc.vol))}`;
}

function addTriangle(acc, ax, ay, az, bx, by, bz, cx, cy, cz) {
  acc.n++;
  const { min, max } = acc;
  if (ax < min[0]) min[0] = ax; if (ax > max[0]) max[0] = ax;
  if (ay < min[1]) min[1] = ay; if (ay > max[1]) max[1] = ay;
  if (az < min[2]) min[2] = az; if (az > max[2]) max[2] = az;
  if (bx < min[0]) min[0] = bx; if (bx > max[0]) max[0] = bx;
  if (by < min[1]) min[1] = by; if (by > max[1]) max[1] = by;
  if (bz < min[2]) min[2] = bz; if (bz > max[2]) max[2] = bz;
  if (cx < min[0]) min[0] = cx; if (cx > max[0]) max[0] = cx;
  if (cy < min[1]) min[1] = cy; if (cy > max[1]) max[1] = cy;
  if (cz < min[2]) min[2] = cz; if (cz > max[2]) max[2] = cz;

  // area = |(b-a) x (c-a)| / 2
  const ex = bx-ax, ey = by-ay, ez = bz-az, fx = cx-ax, fy = cy-ay, fz = cz-az;
  const x = ey*fz - ez*fy, y = ez*fx - ex*fz, z = ex*fy - ey*fx;
  acc.area += Math.sqrt(x*x + y*y + z*z) / 2;
  // signed volume = a . (b x c) / 6
  acc.vol += (ax * (by*cz - bz*cy) + ay * (bz*cx - bx*cz) + az * (bx*cy - by*cx)) / 6;
}
