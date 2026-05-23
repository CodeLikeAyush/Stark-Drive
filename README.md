# Family Personal Drive

A secure, privacy-first personal drive built for home network deployment. Features a Google Photos-style timeline for media and standard document storage, with deduplication and end-to-end encrypted secure vaults.

## Architecture

- **Backend**: Spring Boot (Java), PostgreSQL, MinIO, RabbitMQ
- **Mobile Client**: React Native (Expo)
- **Deployment**: Fully Self-Hosted on Home Network

## Directory Structure

- `/server`: Spring Boot backend REST APIs and services.
- `/mobile-app`: React Native Expo mobile client.
- `/docs`: Additional architecture and setup documentation.

## Setup Instructions

*(To be populated as services are containerized/configured)*

1. **Backend**: Requires PostgreSQL and MinIO instances running. Start the Spring Boot app via `mvnw spring-boot:run`.
2. **Mobile App**: Navigate to `/mobile-app` and run `npm install`, then `npx expo start` to run on emulator/device.

## Security Practices
- Server-Side Encryption (SSE) for standard files.
- End-to-End Encryption (E2EE) for Secure Vault items.
- All communications enforced over HTTPS/TLS.
