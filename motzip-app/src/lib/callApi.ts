// Tiny wrapper over /api/call-restaurant + /api/call-result polling.
// Keeps fetch + URL details out of the React components.

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:8000";

export interface QuestionAnswer {
  value: boolean | null;
  details: string;
  wait_minutes?: number | null;
}

export interface CallResult {
  call_sid: string;
  status: string; // initiated | asking N/M | parsing | completed | failed | busy | no-answer | canceled
  answers: Record<string, QuestionAnswer>;
  raw_speech: string;
  // legacy single-call fields
  can_reserve?: boolean | null;
  wait_minutes?: number | null;
  notes?: string;
}

export interface InitiateCallParams {
  restaurant_name: string;
  phone: string;
  party_size?: number;
  time_preference?: string;
  questions?: string[];
  custom_question?: string;
}

export async function initiateCall(params: InitiateCallParams): Promise<{ call_sid: string }> {
  const res = await fetch(`${SERVER_URL}/api/call-restaurant`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      party_size: 2,
      time_preference: "as soon as possible",
      questions: [],
      custom_question: "",
      ...params,
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchCallResult(call_sid: string): Promise<CallResult | null> {
  const res = await fetch(`${SERVER_URL}/api/call-result/${call_sid}`);
  if (!res.ok) return null;
  return res.json();
}

export const TERMINAL_FAILURES = ["failed", "busy", "no-answer", "canceled"];

// ── Signature dish extraction ───────────────────────────────────────────────

export async function fetchSignatureDishes(placeId: string): Promise<string[]> {
  const res = await fetch(`${SERVER_URL}/api/signature-dishes/${placeId}`);
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data?.dishes) ? data.dishes : [];
}
