# motzip

Boston restaurant 3D map — Google Places API 기반 실시간 데이터, ElevenLabs 음성 검색, Twilio 전화 예약.

## Structure

| Directory | Description |
|---|---|
| `motzip-app/` | Next.js frontend — 3D map (MapLibre + Three.js), 음성 검색 UI, 레스토랑 패널, Twilio 예약 버튼 |
| `motzip-server/` | FastAPI — Google Places API, ElevenLabs STT/TTS, Ollama LLM, Twilio 전화 |
| `motzip-3d/` | 3D 모델 생성 파이프라인 (TRELLIS text-to-3D + mesh 최적화) |

---

## 환경변수 설정 (.env)

`motzip-server/.env` 파일을 아래 내용으로 생성. **키 값은 팀원에게 별도로 전달받을 것.**

```env
# Google Places API (GCP 프로젝트: theta-bliss-486220-s1)
GOOGLE_PLACES_API_KEY=

# ElevenLabs — STT(Scribe) + TTS
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=EXAVITQu4vr4xnSDxMaL   # Sarah (기본값, 변경 가능)

# Twilio — 레스토랑 전화 예약
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=+18447589915

# ngrok — Twilio webhook용 공개 URL (로컬 개발 시 필요)
NGROK_URL=https://xxxx.ngrok-free.app

# 테스트용 수신 번호 오버라이드 (Twilio Trial 계정 한정)
# Trial 계정은 Verified Caller ID로 등록된 번호로만 전화 가능
# 실제 레스토랑에 전화할 경우 이 줄을 삭제하거나 비워둘 것
TWILIO_TEST_TO=
```

---

## Install

### Frontend (motzip-app)

Node.js 20+ 필요.

```bash
cd motzip-app
npm install
```

### Server (motzip-server)

Python 3.11+ 및 [uv](https://docs.astral.sh/uv/) 필요.

```bash
cd motzip-server
uv sync
```

### Ollama (LLM — 음성 필터 추출용)

Ollama 없어도 Google Places + ElevenLabs는 동작함. 음성 쿼리 필터링 정확도 향상을 위해 설치 권장.

```bash
# 설치: https://ollama.com
ollama pull gemma3:4b
ollama serve
```

---

## Run

터미널 3개 필요 (Twilio 전화 기능 사용 시).

### Terminal 1 — 서버

```bash
cd motzip-server
uv run uvicorn main:app --reload
```

http://localhost:8000

### Terminal 2 — 프론트엔드

```bash
cd motzip-app
npm run dev
```

http://localhost:3000

### Terminal 3 — ngrok (Twilio 전화 기능 사용 시만)

```bash
ngrok http 8000
```

출력된 `https://xxxx.ngrok-free.app` URL을 `.env`의 `NGROK_URL`에 입력 후 서버 재시작.

### Terminal 4 (선택) — Ollama

```bash
ollama serve
```

---

## 주요 기능

### 3D 지도
- Google Places API로 주변 식당 ~40개 실시간 로드
- 건물 높이 = 리뷰 수 / 색상 = 평점 (금 → 빨강)
- 건물 옆 보석(octahedron) 아이콘: 주차/휠체어/라이브뮤직/강아지/칵테일 등 특성 표시
- Trending 식당 → 주황색 빔 + 불꽃놀이

### 음성 검색
- 마이크 버튼 꾹 누르고 말하기 → 손 떼면 전송
- ElevenLabs Scribe STT → Ollama LLM 필터 추출 → Google Places 필터링 → ElevenLabs TTS 응답
- 예시 쿼리: *"인당 30불 이하 이탈리안 15분 내"*, *"주차 가능한 데이트 식당"*
- 결과: 조건 맞는 건물만 남고 나머지는 땅속으로 꺼짐 + 파란 스포트라이트

### Twilio 전화 예약
- 식당 클릭 → "예약 / 대기시간 전화 문의" 버튼 (전화번호 있는 식당만 표시)
- Twilio가 식당에 전화 → 예약 가능 여부/대기시간 음성으로 문의
- LLM이 응답 분석 → 앱에 결과 표시 (예약 가능 여부 + 대기 시간)

---

## API 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/restaurants` | 주변 식당 목록 (Google Places) |
| POST | `/api/voice-search` | 음성 파일 → 필터링된 식당 목록 + TTS 응답 |
| POST | `/api/call-restaurant` | Twilio 전화 시작 |
| GET | `/api/call-result/{call_sid}` | 전화 결과 폴링 |
| POST | `/api/search` | 텍스트 자연어 → 구조화 필터 (Ollama) |
| POST | `/api/analyze-reviews` | 리뷰 분석 (Ollama) |
| GET | `/health` | Ollama 연결 상태 확인 |

---

## Twilio Trial 계정 제한 사항

Trial 계정은 [Verified Caller IDs](https://console.twilio.com/phone-numbers/verified)에 등록된 번호로만 전화 가능.
실제 레스토랑 전화 테스트는 계정 업그레이드 후 `TWILIO_TEST_TO` 환경변수를 비워두면 됨.

---

## 3D 모델 파이프라인 (motzip-3d)

사전 빌드된 모델이 `motzip-app/public/models/`에 포함되어 있어 별도 실행 불필요.
모델 재생성이 필요한 경우 [`motzip-3d/README.md`](./motzip-3d/README.md) 참고.
