export type Band = {
  id: string;
  name: string;
  freqStartMHz: number;
  freqEndMHz: number;
  color: string;
  children?: Band[];
};
