package com.family.drive.service;

import com.family.drive.config.RabbitMQConfig;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Service;

@Service
public class MediaProcessorListener {

    @RabbitListener(queues = RabbitMQConfig.MEDIA_PROCESSING_QUEUE)
    public void handleThumbnailGeneration(String fileId) {
        // In a real implementation: fetch file from MinIO, generate thumbnail via ImageMagick/Java2D, save thumbnail back to MinIO
        System.out.println("Processing thumbnail for file ID: " + fileId);
    }

    @RabbitListener(queues = RabbitMQConfig.EXIF_EXTRACTION_QUEUE)
    public void handleExifExtraction(String fileId) {
        // In a real implementation: fetch file, read EXIF metadata (date taken, GPS), update DriveFile record in PostgreSQL
        System.out.println("Extracting EXIF data for file ID: " + fileId);
    }
}
