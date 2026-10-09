/**
 * Server-side DOM / Canvas polyfills for Node.js & Next.js runtime.
 * Pure TypeScript/JavaScript implementation providing DOMMatrix, DOMMatrixReadOnly,
 * Path2D, ImageData, DOMPoint, DOMPointReadOnly, DOMRect, and DOMRectReadOnly.
 * Satisfies pdfjs-dist / pdf-parse requirements seamlessly in Turbopack.
 */

export function ensureDomPolyfills() {
  const g = globalThis as any;

  // 1. Pure JS Implementation: DOMMatrix & DOMMatrixReadOnly
  if (!g.DOMMatrix) {
    class DOMMatrixFallback {
      m11 = 1;
      m12 = 0;
      m13 = 0;
      m14 = 0;
      m21 = 0;
      m22 = 1;
      m23 = 0;
      m24 = 0;
      m31 = 0;
      m32 = 0;
      m33 = 1;
      m34 = 0;
      m41 = 0;
      m42 = 0;
      m43 = 0;
      m44 = 1;
      is2D = true;

      get a() { return this.m11; }
      set a(v: number) { this.m11 = Number(v) || 0; }
      get b() { return this.m12; }
      set b(v: number) { this.m12 = Number(v) || 0; }
      get c() { return this.m21; }
      set c(v: number) { this.m21 = Number(v) || 0; }
      get d() { return this.m22; }
      set d(v: number) { this.m22 = Number(v) || 0; }
      get e() { return this.m41; }
      set e(v: number) { this.m41 = Number(v) || 0; }
      get f() { return this.m42; }
      set f(v: number) { this.m42 = Number(v) || 0; }

      get isIdentity(): boolean {
        return (
          this.m11 === 1 && this.m12 === 0 && this.m13 === 0 && this.m14 === 0 &&
          this.m21 === 0 && this.m22 === 1 && this.m23 === 0 && this.m24 === 0 &&
          this.m31 === 0 && this.m32 === 0 && this.m33 === 1 && this.m34 === 0 &&
          this.m41 === 0 && this.m42 === 0 && this.m43 === 0 && this.m44 === 1
        );
      }

      constructor(init?: string | number[] | ArrayLike<number> | any) {
        if (!init) return;

        // 1. Array or TypedArray (Float32Array, Float64Array, etc.)
        if (typeof init === "object" && typeof init.length === "number") {
          const len = init.length;
          if (len === 6) {
            this.m11 = Number(init[0]) || 0;
            this.m12 = Number(init[1]) || 0;
            this.m21 = Number(init[2]) || 0;
            this.m22 = Number(init[3]) || 0;
            this.m41 = Number(init[4]) || 0;
            this.m42 = Number(init[5]) || 0;
            this.is2D = true;
          } else if (len >= 16) {
            this.m11 = Number(init[0]) || 0;
            this.m12 = Number(init[1]) || 0;
            this.m13 = Number(init[2]) || 0;
            this.m14 = Number(init[3]) || 0;
            this.m21 = Number(init[4]) || 0;
            this.m22 = Number(init[5]) || 0;
            this.m23 = Number(init[6]) || 0;
            this.m24 = Number(init[7]) || 0;
            this.m31 = Number(init[8]) || 0;
            this.m32 = Number(init[9]) || 0;
            this.m33 = Number(init[10]) || 0;
            this.m34 = Number(init[11]) || 0;
            this.m41 = Number(init[12]) || 0;
            this.m42 = Number(init[13]) || 0;
            this.m43 = Number(init[14]) || 0;
            this.m44 = Number(init[15]) || 0;
            this.is2D = false;
          }
        } else if (typeof init === "object") {
          // 2. Object with a/b/c/d/e/f or m11/m12...
          if ("m11" in init || "a" in init) {
            this.m11 = Number(init.m11 ?? init.a) || 0;
            this.m12 = Number(init.m12 ?? init.b) || 0;
            this.m21 = Number(init.m21 ?? init.c) || 0;
            this.m22 = Number(init.m22 ?? init.d) || 0;
            this.m41 = Number(init.m41 ?? init.e) || 0;
            this.m42 = Number(init.m42 ?? init.f) || 0;
            if ("m13" in init) this.m13 = Number(init.m13) || 0;
            if ("m14" in init) this.m14 = Number(init.m14) || 0;
            if ("m23" in init) this.m23 = Number(init.m23) || 0;
            if ("m24" in init) this.m24 = Number(init.m24) || 0;
            if ("m31" in init) this.m31 = Number(init.m31) || 0;
            if ("m32" in init) this.m32 = Number(init.m32) || 0;
            if ("m33" in init) this.m33 = Number(init.m33) || 1;
            if ("m34" in init) this.m34 = Number(init.m34) || 0;
            if ("m43" in init) this.m43 = Number(init.m43) || 0;
            if ("m44" in init) this.m44 = Number(init.m44) || 1;
            this.is2D = init.is2D ?? (this.m13 === 0 && this.m14 === 0 && this.m23 === 0 && this.m24 === 0 && this.m31 === 0 && this.m32 === 0 && this.m33 === 1 && this.m34 === 0 && this.m43 === 0 && this.m44 === 1);
          }
        } else if (typeof init === "string") {
          const match = init.match(/[-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?/g);
          if (match && (match.length === 6 || match.length >= 16)) {
            const nums = match.map(Number);
            return new DOMMatrixFallback(nums);
          }
        }
      }

      multiply(other: any): DOMMatrixFallback {
        const res = new DOMMatrixFallback();
        const o = other || {};
        const oa = Number(o.a ?? o.m11 ?? 1);
        const ob = Number(o.b ?? o.m12 ?? 0);
        const oc = Number(o.c ?? o.m21 ?? 0);
        const od = Number(o.d ?? o.m22 ?? 1);
        const oe = Number(o.e ?? o.m41 ?? 0);
        const of_ = Number(o.f ?? o.m42 ?? 0);

        res.m11 = this.m11 * oa + this.m21 * ob;
        res.m12 = this.m12 * oa + this.m22 * ob;
        res.m21 = this.m11 * oc + this.m21 * od;
        res.m22 = this.m12 * oc + this.m22 * od;
        res.m41 = this.m11 * oe + this.m21 * of_ + this.m41;
        res.m42 = this.m12 * oe + this.m22 * of_ + this.m42;
        return res;
      }

      multiplySelf(other: any) {
        const m = this.multiply(other);
        this.m11 = m.m11;
        this.m12 = m.m12;
        this.m21 = m.m21;
        this.m22 = m.m22;
        this.m41 = m.m41;
        this.m42 = m.m42;
        return this;
      }

      preMultiplySelf(other: any) {
        const m = new DOMMatrixFallback(other).multiply(this);
        this.m11 = m.m11;
        this.m12 = m.m12;
        this.m21 = m.m21;
        this.m22 = m.m22;
        this.m41 = m.m41;
        this.m42 = m.m42;
        return this;
      }

      translate(tx = 0, ty = 0, tz = 0) {
        const res = new DOMMatrixFallback(this);
        res.translateSelf(tx, ty, tz);
        return res;
      }

      translateSelf(tx = 0, ty = 0, tz = 0) {
        this.m41 += tx;
        this.m42 += ty;
        this.m43 += tz;
        return this;
      }

      scale(scaleX = 1, scaleY = scaleX, scaleZ = 1) {
        const res = new DOMMatrixFallback(this);
        res.scaleSelf(scaleX, scaleY, scaleZ);
        return res;
      }

      scaleSelf(scaleX = 1, scaleY = scaleX, scaleZ = 1) {
        this.m11 *= scaleX;
        this.m12 *= scaleX;
        this.m21 *= scaleY;
        this.m22 *= scaleY;
        this.m31 *= scaleZ;
        this.m32 *= scaleZ;
        return this;
      }

      rotate(rotX = 0, rotY = 0, rotZ = 0) {
        const res = new DOMMatrixFallback(this);
        res.rotateSelf(rotX, rotY, rotZ);
        return res;
      }

      rotateSelf(rotX = 0, rotY = 0, rotZ = 0) {
        return this;
      }

      inverse() {
        const res = new DOMMatrixFallback(this);
        res.invertSelf();
        return res;
      }

      invertSelf() {
        const det = this.m11 * this.m22 - this.m12 * this.m21;
        if (Math.abs(det) > 1e-12) {
          const a = this.m22 / det;
          const b = -this.m12 / det;
          const c = -this.m21 / det;
          const d = this.m11 / det;
          const e = (this.m21 * this.m42 - this.m22 * this.m41) / det;
          const f = (this.m12 * this.m41 - this.m11 * this.m42) / det;
          this.m11 = a;
          this.m12 = b;
          this.m21 = c;
          this.m22 = d;
          this.m41 = e;
          this.m42 = f;
        }
        return this;
      }

      transformPoint(point?: any) {
        const x = Number(point?.x) || 0;
        const y = Number(point?.y) || 0;
        return {
          x: x * this.m11 + y * this.m21 + this.m41,
          y: x * this.m12 + y * this.m22 + this.m42,
          z: Number(point?.z) || 0,
          w: Number(point?.w) || 1,
        };
      }

      toFloat32Array() {
        return new Float32Array([
          this.m11, this.m12, this.m13, this.m14,
          this.m21, this.m22, this.m23, this.m24,
          this.m31, this.m32, this.m33, this.m34,
          this.m41, this.m42, this.m43, this.m44,
        ]);
      }

      toFloat64Array() {
        return new Float64Array([
          this.m11, this.m12, this.m13, this.m14,
          this.m21, this.m22, this.m23, this.m24,
          this.m31, this.m32, this.m33, this.m34,
          this.m41, this.m42, this.m43, this.m44,
        ]);
      }

      static fromMatrix(other: any) {
        return new DOMMatrixFallback(other);
      }
      static fromFloat32Array(arr: Float32Array) {
        return new DOMMatrixFallback(arr);
      }
      static fromFloat64Array(arr: Float64Array) {
        return new DOMMatrixFallback(arr);
      }
    }

    g.DOMMatrix = DOMMatrixFallback;
  }

  if (!g.DOMMatrixReadOnly) {
    g.DOMMatrixReadOnly = g.DOMMatrix;
  }

  // 2. Pure JS Implementation: Path2D
  if (!g.Path2D) {
    class Path2DFallback {
      constructor(path?: any) {}
      addPath(path: any, transform?: any) {}
      closePath() {}
      moveTo(x: number, y: number) {}
      lineTo(x: number, y: number) {}
      bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number) {}
      quadraticCurveTo(cpx: number, cpy: number, x: number, y: number) {}
      arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, counterclockwise?: boolean) {}
      arcTo(x1: number, y1: number, x2: number, y2: number, radius: number) {}
      ellipse(x: number, y: number, radiusX: number, radiusY: number, rotation: number, startAngle: number, endAngle: number, counterclockwise?: boolean) {}
      rect(x: number, y: number, w: number, h: number) {}
      roundRect(x: number, y: number, w: number, h: number, radii?: any) {}
    }
    g.Path2D = Path2DFallback;
  }

  // 3. Pure JS Implementation: ImageData
  if (!g.ImageData) {
    class ImageDataFallback {
      data: Uint8ClampedArray;
      width: number;
      height: number;
      colorSpace: string = "srgb";
      constructor(wOrData: any, hOrW?: number, maybeH?: number) {
        if (typeof wOrData === "number") {
          this.width = wOrData;
          this.height = Number(hOrW) || 0;
          this.data = new Uint8ClampedArray(this.width * this.height * 4);
        } else if (wOrData && typeof wOrData.length === "number") {
          this.data = wOrData;
          this.width = Number(hOrW) || 0;
          this.height = Number(maybeH) || (this.width ? Math.floor(wOrData.length / (this.width * 4)) : 0);
        } else {
          this.width = 0;
          this.height = 0;
          this.data = new Uint8ClampedArray(0);
        }
      }
    }
    g.ImageData = ImageDataFallback;
  }

  // 4. Pure JS Implementation: DOMPoint & DOMPointReadOnly
  if (!g.DOMPoint) {
    class DOMPointFallback {
      x: number;
      y: number;
      z: number;
      w: number;
      constructor(x = 0, y = 0, z = 0, w = 1) {
        this.x = Number(x) || 0;
        this.y = Number(y) || 0;
        this.z = Number(z) || 0;
        this.w = Number(w) || 1;
      }
      static fromPoint(other: any) {
        return new DOMPointFallback(other?.x, other?.y, other?.z, other?.w);
      }
    }
    g.DOMPoint = DOMPointFallback;
  }

  if (!g.DOMPointReadOnly) {
    g.DOMPointReadOnly = g.DOMPoint;
  }

  // 5. Pure JS Implementation: DOMRect & DOMRectReadOnly
  if (!g.DOMRect) {
    class DOMRectFallback {
      x: number;
      y: number;
      width: number;
      height: number;
      get top() { return this.y; }
      get right() { return this.x + this.width; }
      get bottom() { return this.y + this.height; }
      get left() { return this.x; }
      constructor(x = 0, y = 0, width = 0, height = 0) {
        this.x = Number(x) || 0;
        this.y = Number(y) || 0;
        this.width = Number(width) || 0;
        this.height = Number(height) || 0;
      }
      static fromRect(other: any) {
        return new DOMRectFallback(other?.x, other?.y, other?.width, other?.height);
      }
    }
    g.DOMRect = DOMRectFallback;
  }

  if (!g.DOMRectReadOnly) {
    g.DOMRectReadOnly = g.DOMRect;
  }
}

// Auto-run polyfills immediately upon module load
ensureDomPolyfills();
