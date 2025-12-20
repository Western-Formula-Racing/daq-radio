FROM python:3.11-slim

WORKDIR /app

# Install system dependencies for CAN and networking
RUN apt-get update && apt-get install -y \
    can-utils \
    iproute2 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY telemetry.py .

# Use environment variables for configuration
ENV ROLE=auto
ENV REMOTE_IP=192.168.1.100
ENV UDP_PORT=5005
ENV TCP_PORT=5006
ENV REDIS_URL=redis://localhost:6379/0

CMD ["python", "telemetry.py"]

