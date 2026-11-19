// Shapes shared by the browser and the API routes.

export type UploadedDoc = { fileId: string; title: string };

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type Citation = {
  documentTitle: string;
  startPage: number;
  endPage: number; // exclusive, as returned by the API
  quote: string;
};

// One line of the newline-delimited JSON stream sent by /api/chat.
export type StreamEvent =
  | { type: "text"; text: string }
  | { type: "citation"; citation: Citation }
  | { type: "error"; message: string }
  | { type: "done" };
