# Starts the API (port 8000) and the web app (port 5173) in two windows.
$root = $PSScriptRoot
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root'; .venv\Scripts\python -m uvicorn backend.app.main:app --reload --port 8000"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\frontend'; npm run dev"
Start-Sleep -Seconds 3
Start-Process "http://localhost:5173"
