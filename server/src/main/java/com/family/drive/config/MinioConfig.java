package com.family.drive.config;

import io.minio.MinioClient;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class MinioConfig {

    @org.springframework.beans.factory.annotation.Value("${minio.url}")
    private String url;

    @org.springframework.beans.factory.annotation.Value("${minio.access-key}")
    private String accessKey;

    @org.springframework.beans.factory.annotation.Value("${minio.secret-key}")
    private String secretKey;

    @Bean
    public MinioClient minioClient() {
        return MinioClient.builder()
                .endpoint(url)
                .credentials(accessKey, secretKey)
                .build();
    }
}
