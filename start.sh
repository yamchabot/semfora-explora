#!/bin/bash
# Start Semfora Explorer — backend + frontend

set -e
cd "$(dirname "$0")"

# Backend
echo "Starting FastAPI backend on http://localhost:8000 ..."
cd backend
python3 -m uvicorn main:app --reload --port 8000 &
BACKEND_PID=$!
cd ..

# Frontend
echo "Starting React frontend on http://localhost:5173 ..."
cd frontend
npm run dev &
FRONTEND_PID=$!
cd ..

echo ""
echo "  Backend:  http://localhost:8000"
echo "  Frontend: http://localhost:5173"
echo "  API docs: http://localhost:8000/docs"
echo ""
echo "Press Ctrl+C to stop both servers."

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT TERM
wait
