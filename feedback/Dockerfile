# Feedback hub for the portfolio and its projects (see app.py).
FROM python:3.12-alpine
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && adduser -D -u 10001 hub && mkdir -p /data && chown hub /data
COPY app.py .
USER hub
EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*", "--no-server-header"]
