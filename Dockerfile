# Use an ultra-lightweight Alpine Linux image
FROM alpine:latest

# Install necessary system utilities (unzip and ca-certificates for secure requests)
RUN apk add --no-cache unzip ca-certificates

# Define the PocketBase version to use
ENV PB_VERSION=0.22.14

# Download and extract the official Linux PocketBase binary
ADD https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip /tmp/pb.zip
RUN unzip /tmp/pb.zip -d /pb/ && rm /tmp/pb.zip

# Copy your local public frontend folder and migration assets into the image
COPY ./pocketbase-backend/pb_public /pb/pb_public
COPY ./pocketbase-backend/pb_migrations /pb/pb_migrations

# Expose the default web server port
EXPOSE 8080

# Start PocketBase and dynamically bind it to Railway's assigned port variable
CMD ["sh", "-c", "/pb/pocketbase serve --http=0.0.0.0:${PORT:-8080}"]
