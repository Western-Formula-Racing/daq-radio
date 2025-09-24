from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()

class TestReturn(BaseModel):
    health: str
    status_code: int

@app.get("/health")
def health_check():
    return TestReturn(health="Healthy", status_code=200)

