FROM python:3.9-slim

WORKDIR /app

RUN pip install python-can cantools

COPY car.py /app/car.py

CMD ["python", "car.py"]
