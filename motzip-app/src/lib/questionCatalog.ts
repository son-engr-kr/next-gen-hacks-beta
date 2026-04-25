// Catalog of structured questions the user can ask via the AI phone call.
// Mirrors QUESTION_CATALOG in motzip-server/catalog.py — keep in sync.
// "custom" is a synthetic key the server appends when the user provides a
// freeform extra question; not user-selectable here.

export interface QuestionDef {
  key: string;
  label: string;
}

export const QUESTION_CATALOG: QuestionDef[] = [
  { key: "reservation", label: "Reservation" },
  { key: "wheelchair", label: "Wheelchair access" },
  { key: "vegetarian", label: "Vegetarian options" },
  { key: "outdoor", label: "Outdoor seating" },
  { key: "dogs", label: "Allows dogs" },
  { key: "parking", label: "Parking" },
  { key: "music", label: "Live music" },
];

export const QUESTION_LABEL_MAP: Record<string, string> = {
  ...Object.fromEntries(QUESTION_CATALOG.map((q) => [q.key, q.label])),
  custom: "Your question",
};
