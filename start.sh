#!/bin/bash
cd "$(dirname "$0")"

# .env.local에서 환경변수 직접 로드
export $(grep -v '^#' .env.local | xargs)

npm run dev
