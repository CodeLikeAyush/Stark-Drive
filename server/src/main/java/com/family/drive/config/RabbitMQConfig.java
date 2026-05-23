package com.family.drive.config;

import org.springframework.amqp.core.Queue;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class RabbitMQConfig {

    public static final String MEDIA_PROCESSING_QUEUE = "media.processing.queue";
    public static final String EXIF_EXTRACTION_QUEUE = "exif.extraction.queue";

    @Bean
    public Queue mediaProcessingQueue() {
        return new Queue(MEDIA_PROCESSING_QUEUE, true);
    }

    @Bean
    public Queue exifExtractionQueue() {
        return new Queue(EXIF_EXTRACTION_QUEUE, true);
    }
}
