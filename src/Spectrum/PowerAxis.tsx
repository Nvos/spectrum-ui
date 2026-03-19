import * as styles from "./PowerAxis.css";
import { computePowerTicks } from "./powerAxisUtils";

type Props = {
  powerMin: number; // dBm
  powerMax: number; // dBm
};

export const PowerAxis = ({ powerMin, powerMax }: Props) => {
  const ticks = computePowerTicks(powerMin, powerMax);

  return (
    <div className={styles.container}>
      {ticks.map(({ dbm, pct }) => (
        <div
          key={dbm}
          className={styles.tickRow}
          style={{ top: `${pct}%`, transform: "translateY(-50%)" }}
        >
          <span className={styles.tickLabel}>{dbm}</span>
          <div className={styles.tickLine} />
        </div>
      ))}
    </div>
  );
};
