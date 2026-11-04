# One image for the Python services (app, governance worker, console, tests).
# Source code is bind-mounted at /workspace by docker-compose, so edits need no rebuild.
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONPATH=/workspace DEEPEVAL_TELEMETRY_OPT_OUT=YES \
    DEEPEVAL_RESULTS_FOLDER=/tmp/deepeval MLFLOW_ENABLE_ASYNC_LOGGING=false
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt
WORKDIR /workspace
