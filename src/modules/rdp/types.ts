export type RdpConnectOptions = {
  host: string;
  port?: number;
  username?: string;
  password?: string;
  domain?: string;
  width?: number;
  height?: number;
  ignore_cert?: boolean;
};

export type RdpConnectionProfile = {
  id: string;
  name: string;
  host: string;
  port: number;
  username?: string;
  password?: string;
  domain?: string;
  width?: number;
  height?: number;
  ignoreCert?: boolean;
  color?: string;
  lastConnectedAt?: number;
};

export type RdpSessionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export type RdpEvent =
  | { type: "connecting"; payload: { status: string } }
  | { type: "connected"; payload: { width: number; height: number } }
  | {
      type: "bitmap";
      payload: {
        x: number;
        y: number;
        width: number;
        height: number;
        data: string;
      };
    }
  | { type: "clipboard"; payload: { text: string } }
  | { type: "error"; payload: { message: string } }
  | { type: "disconnected"; payload: { reason?: string } };

export type RdpInput =
  | { type: "mouse_move"; x: number; y: number }
  | { type: "mouse_button"; button: number; pressed: boolean }
  | { type: "mouse_wheel"; vertical: boolean; delta: number }
  | { type: "key"; scancode: number; pressed: boolean; extended: boolean }
  | { type: "unicode_key"; code: number }
  | { type: "clipboard"; text: string };

export type RdpDisplayMetrics = {
  width: number;
  height: number;
  scaleMode: "fit" | "fill" | "1:1";
};
