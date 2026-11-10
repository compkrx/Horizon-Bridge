ARG TOOLCHAIN_IMAGE=horizonrelay-toolchain:26.3

FROM debian:trixie-slim AS decompiler
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN curl --fail --silent --show-error --location --retry 3 \
    https://repo.maven.apache.org/maven2/org/vineflower/vineflower/1.12.0/vineflower-1.12.0.jar \
    -o /vineflower.jar && \
    echo '1dfcfe974395734fa467ce620661c7623d05ba83670de0529b1fbd63ff548b9d  /vineflower.jar' | sha256sum -c -

FROM python:3.12-slim-trixie AS api
WORKDIR /app
COPY api/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt && install -d -o 10001 -g 10001 /data && \
    install -o 10001 -g 10001 /dev/null /data/.initialized
COPY api api
COPY engine engine
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 HB_DATA_DIR=/data
USER 10001:10001
EXPOSE 8788
CMD ["python", "-m", "uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8788", "--no-proxy-headers", "--no-access-log", "--limit-concurrency", "70"]

FROM python:3.12-slim-trixie AS lite
RUN apt-get update && apt-get install -y --no-install-recommends openjdk-21-jre-headless && rm -rf /var/lib/apt/lists/* && \
    install -d -o 10001 -g 10001 /data /scratch && install -o 10001 -g 10001 /dev/null /data/.initialized
COPY --from=decompiler /vineflower.jar /opt/vineflower.jar
WORKDIR /app
COPY api api
COPY engine engine
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 HB_DATA_DIR=/data HB_SCRATCH_DIR=/scratch \
    HB_REQUIRE_SANDBOX=1 HB_VINEFLOWER_JAR=/opt/vineflower.jar
USER 10001:10001
CMD ["python", "-m", "api.worker"]

FROM ${TOOLCHAIN_IMAGE} AS full
USER root
RUN apt-get update && apt-get install -y --no-install-recommends openjdk-21-jre-headless && rm -rf /var/lib/apt/lists/* && \
    install -d -o 10001 -g 10001 /data /scratch && install -o 10001 -g 10001 /dev/null /data/.initialized
COPY --from=decompiler /vineflower.jar /opt/vineflower.jar
WORKDIR /app
COPY api api
COPY engine engine
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 HB_DATA_DIR=/data HB_SCRATCH_DIR=/scratch \
    HB_REQUIRE_SANDBOX=1 HB_VINEFLOWER_JAR=/opt/vineflower.jar
USER 10001:10001
CMD ["python3", "-m", "api.worker"]
