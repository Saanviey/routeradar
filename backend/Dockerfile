

FROM python:3.12-slim
 
WORKDIR /app
 
# Copy requirements and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
 
# Copy all backend files
COPY . .
 
# Expose port 7860 (Hugging Face default)
EXPOSE 7860
 
# Start the FastAPI app
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860"]