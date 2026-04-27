// Subtitle styling presets — public so App.tsx can also import default style.

export type SubtitleStyle = {
  font: string;
  size: number;
  color: string; // #RRGGBB
  borderSize: number;
  borderColor: string;
  shadowOffset: number;
  marginY: number;
  bold: boolean;
  alignY: "top" | "center" | "bottom";
};

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  font: "sans-serif",
  size: 55,
  color: "#FFFFFF",
  borderSize: 3,
  borderColor: "#000000",
  shadowOffset: 0,
  marginY: 22,
  bold: false,
  alignY: "bottom",
};

export const PRESETS: Record<string, { label: string; style: SubtitleStyle }> = {
  default: {
    label: "Default",
    style: DEFAULT_SUBTITLE_STYLE,
  },
  minimal: {
    label: "Minimal",
    style: {
      font: "sans-serif",
      size: 42,
      color: "#FFFFFF",
      borderSize: 1.5,
      borderColor: "#000000",
      shadowOffset: 0,
      marginY: 30,
      bold: false,
      alignY: "bottom",
    },
  },
  highVis: {
    label: "High Visibility",
    style: {
      font: "sans-serif",
      size: 64,
      color: "#FFFF00",
      borderSize: 5,
      borderColor: "#000000",
      shadowOffset: 1,
      marginY: 40,
      bold: true,
      alignY: "bottom",
    },
  },
  anime: {
    label: "Anime",
    style: {
      font: "sans-serif",
      size: 60,
      color: "#FFFFFF",
      borderSize: 4,
      borderColor: "#000000",
      shadowOffset: 1,
      marginY: 20,
      bold: true,
      alignY: "top",
    },
  },
};

export const FONTS = [
  "sans-serif",
  "Arial",
  "Verdana",
  "Tahoma",
  "Georgia",
  "Times New Roman",
  "Courier New",
];
