#!/usr/bin/env bash
# Deploy motzip-server to Cloud Run.
#
# First-run prereqs (already done once):
#   - APIs enabled: run, cloudbuild, artifactregistry, aiplatform
#   - Service account `motzip-server` exists with roles/aiplatform.user
#   - `gcloud auth login` + `gcloud config set project theta-bliss-486220-s1`
#
# Usage:
#   ./deploy.sh
#
# After first deploy, copy the printed URL into:
#   - Twilio console webhook (or NGROK_URL env var below)
#   - motzip-app frontend's NEXT_PUBLIC_SERVER_URL

set -euo pipefail

PROJECT="theta-bliss-486220-s1"
REGION="us-central1"
SERVICE="motzip-server"
SA="motzip-server@${PROJECT}.iam.gserviceaccount.com"

# Read secrets from local .env so we don't have to repeat them on the CLI.
# (For production you'd use Secret Manager — for hackathon, this is fine.)
if [[ ! -f .env ]]; then
  echo ".env missing — copy keys into .env first."
  exit 1
fi
set -a
source .env
set +a

# After first deploy you'll know the URL — pass it as NGROK_URL so Twilio
# webhooks dial back to Cloud Run instead of the old ngrok tunnel.
PUBLIC_URL="${PUBLIC_URL:-${NGROK_URL:-}}"

gcloud run deploy "$SERVICE" \
  --project="$PROJECT" \
  --region="$REGION" \
  --source=. \
  --service-account="$SA" \
  --allow-unauthenticated \
  --min-instances=0 \
  --max-instances=10 \
  --cpu-boost \
  --memory=1Gi \
  --concurrency=80 \
  --timeout=300 \
  --set-env-vars="^|^LLM_PROVIDER=gemini|GCP_PROJECT=${PROJECT}|GCP_LOCATION=${REGION}|MOTZIP_GEMINI_MODEL=gemini-2.0-flash|GOOGLE_PLACES_API_KEY=${GOOGLE_PLACES_API_KEY}|ELEVENLABS_API_KEY=${ELEVENLABS_API_KEY}|ELEVENLABS_VOICE_ID=${ELEVENLABS_VOICE_ID:-EXAVITQu4vr4xnSDxMaL}|TWILIO_ACCOUNT_SID=${TWILIO_ACCOUNT_SID}|TWILIO_AUTH_TOKEN=${TWILIO_AUTH_TOKEN}|TWILIO_PHONE_NUMBER=${TWILIO_PHONE_NUMBER}|TWILIO_TEST_TO=${TWILIO_TEST_TO:-}|NGROK_URL=${PUBLIC_URL}|CORS_ORIGINS=${CORS_ORIGINS:-http://localhost:3000,https://*.vercel.app}"

echo
echo "Deploy done. Service URL:"
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format="value(status.url)"
echo
echo "Next:"
echo "  1) Re-run with PUBLIC_URL=<that URL> ./deploy.sh   (so NGROK_URL points to itself)"
echo "  2) Set NEXT_PUBLIC_SERVER_URL to that URL in Vercel"
echo "  3) Add the Vercel domain to CORS_ORIGINS in config.py"
