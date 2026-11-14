// Lorenz chaos-clock for allocation preference
(function (root) {
  'use strict';
  class Lorenz {
    constructor(seed) {
      this.x = typeof seed === 'number' ? seed : 0.1;
      this.y = 1.0;
      this.z = 1.5;
      this.sigma = 10;
      this.rho = 28;
      this.beta = 8 / 3;
      this.dt = 0.001;
    }
    step() {
      const { x, y, z, sigma, rho, beta, dt } = this;
      this.x = x + sigma * (y - x) * dt;
      this.y = y + (x * (rho - z) - y) * dt;
      this.z = z + (x * y - beta * z) * dt;
      return this;
    }
    orbit(n) {
      const out = [];
      for (let i = 0; i < n; i++) {
        this.step();
        out.push(Math.abs(this.x) % 1);
      }
      return out;
    }
  }
  if (typeof self !== 'undefined') self.Lorenz = Lorenz;
  if (typeof window !== 'undefined') window.Lorenz = Lorenz;
  if (typeof module !== 'undefined' && module.exports) module.exports = Lorenz;
})(typeof self !== 'undefined' ? self : this);
