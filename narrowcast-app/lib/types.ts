export type MediaType = "image" | "video" | "url";

export interface PlaylistItem {
  id: string;
  type: MediaType;
  url: string;
  duration_seconds: number;
  order_index: number;
  is_active: boolean;
}

export interface Alert {
  id: string;
  message: string;
  is_active: boolean;
  created_at: string;
}
