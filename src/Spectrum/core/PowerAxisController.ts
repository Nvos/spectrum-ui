import * as styles from "./styles.css";
import { computePowerTicks } from "./powerAxisUtils";

export class PowerAxisController {
  private container: HTMLElement | null = null;
  private displayMin: number;
  private displayMax: number;

  constructor(displayMin: number, displayMax: number) {
    this.displayMin = displayMin;
    this.displayMax = displayMax;
  }

  mount(container: HTMLElement) {
    this.container = container;
    container.className = styles.powerAxisContainer;
    this.render();
  }

  update(displayMin: number, displayMax: number) {
    this.displayMin = displayMin;
    this.displayMax = displayMax;
    this.render();
  }

  private render() {
    const container = this.container;
    if (!container) return;
    container.textContent = "";
    for (const { dbm, pct } of computePowerTicks(this.displayMin, this.displayMax)) {
      const row = document.createElement("div");
      row.className = styles.powerAxisTickRow;
      row.style.top = `${pct}%`;
      const label = document.createElement("span");
      label.className = styles.powerAxisTickLabel;
      label.textContent = String(dbm);
      const line = document.createElement("div");
      line.className = styles.powerAxisTickLine;
      row.append(label, line);
      container.append(row);
    }
  }

  destroy() {
    if (this.container) this.container.textContent = "";
    this.container = null;
  }
}
