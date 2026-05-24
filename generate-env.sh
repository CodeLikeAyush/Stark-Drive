#!/bin/bash
# generate-env.sh
# Script to generate a secure .env file for StarkDrive on Linux/macOS

ENV_FILE=".env"

if [ -f "$ENV_FILE" ]; then
    echo -e "\033[1;33mWarning: $ENV_FILE already exists.\033[0m"
    read -p "Do you want to overwrite it? (Y/N): " response
    if [[ ! "$response" =~ ^[Yy]$ ]]; then
        echo -e "\033[1;31mAborting.\033[0m"
        exit 1
    fi
fi

echo -e "\033[1;36mGenerating secure credentials...\033[0m"

# Function to generate a random alphanumeric string
generate_string() {
    local length=$1
    # Use /dev/urandom to generate secure random strings
    LC_ALL=C tr -dc 'a-zA-Z0-9' < /dev/urandom | fold -w "$length" | head -n 1
}

# Function to generate a Base64 encoded 32-byte key (for MinIO KMS)
generate_base64_key() {
    head -c 32 /dev/urandom | base64
}

# Generate Values
DB_PASSWORD=$(generate_string 24)
MINIO_PASSWORD=$(generate_string 32)
JWT_SECRET=$(generate_string 64)
MINIO_KMS_KEY=$(generate_base64_key)
RABBITMQ_PASS=$(generate_string 20)

# Create the .env content
cat > "$ENV_FILE" << EOF
# Stark Drive - Environment Configuration
# Automatically generated on $(date)

# PostgreSQL Configuration
POSTGRES_USER=postgres
POSTGRES_PASSWORD=$DB_PASSWORD
POSTGRES_DB=family_drive

# MinIO Configuration
MINIO_ROOT_USER=admin
MINIO_ROOT_PASSWORD=$MINIO_PASSWORD
MINIO_KMS_SECRET_KEY=family-key:$MINIO_KMS_KEY

# RabbitMQ Configuration
RABBITMQ_DEFAULT_USER=starkadmin
RABBITMQ_DEFAULT_PASS=$RABBITMQ_PASS

# Backend JWT Secret
JWT_SECRET=$JWT_SECRET
EOF

echo -e "\n\033[1;32mSuccessfully created $ENV_FILE with secure, randomly generated credentials!\033[0m"
echo -e "\033[1;33mKeep this file secure and never commit it to version control.\033[0m"
