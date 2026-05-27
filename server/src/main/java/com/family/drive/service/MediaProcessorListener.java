package com.family.drive.service;

import com.family.drive.config.RabbitMQConfig;
import com.family.drive.model.DriveFile;
import com.family.drive.repository.DriveFileRepository;
import io.minio.MinioClient;
import io.minio.GetObjectArgs;
import io.minio.PutObjectArgs;
import net.coobird.thumbnailator.Thumbnails;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.rendering.PDFRenderer;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Service;

import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.Optional;

@Service
public class MediaProcessorListener {

    private final DriveFileRepository fileRepository;
    private final MinioClient minioClient;
    private final String BUCKET_NAME = "family-drive";

    public MediaProcessorListener(DriveFileRepository fileRepository, MinioClient minioClient) {
        this.fileRepository = fileRepository;
        this.minioClient = minioClient;
    }

    @RabbitListener(queues = RabbitMQConfig.MEDIA_PROCESSING_QUEUE)
    public void handleThumbnailGeneration(String fileIdString) {
        System.out.println("Processing thumbnail for file ID: " + fileIdString);
        try {
            Long fileId = Long.parseLong(fileIdString.trim());
            Optional<DriveFile> fileOpt = fileRepository.findById(fileId);
            if (fileOpt.isEmpty()) {
                System.out.println("File not found in database for ID: " + fileId);
                return;
            }
            DriveFile file = fileOpt.get();
            if (file.isVault()) {
                System.out.println("Skipping thumbnail generation for vault file: " + fileId);
                return;
            }

            String contentType = file.getContentType();
            String nameLower = file.getOriginalFilename().toLowerCase();
            boolean isImage = (contentType != null && contentType.startsWith("image/"))
                    || nameLower.endsWith(".jpg") || nameLower.endsWith(".jpeg")
                    || nameLower.endsWith(".png") || nameLower.endsWith(".gif")
                    || nameLower.endsWith(".webp") || nameLower.endsWith(".bmp");
            boolean isPdf = (contentType != null && contentType.equals("application/pdf"))
                    || nameLower.endsWith(".pdf");

            if (!isImage && !isPdf) {
                System.out.println("File is neither image nor PDF. ID: " + fileId);
                return;
            }

            byte[] thumbnailBytes = null;

            // 1. Get raw file from MinIO
            try (InputStream originalStream = minioClient.getObject(
                    GetObjectArgs.builder()
                            .bucket(BUCKET_NAME)
                            .object(file.getStoragePath())
                            .build()
            )) {
                if (isImage) {
                    ByteArrayOutputStream os = new ByteArrayOutputStream();
                    Thumbnails.of(originalStream)
                            .size(200, 200)
                            .outputFormat("jpg")
                            .toOutputStream(os);
                    thumbnailBytes = os.toByteArray();
                } else if (isPdf) {
                    // Read original PDF stream fully into a byte array
                    ByteArrayOutputStream byteBuffer = new ByteArrayOutputStream();
                    byte[] buffer = new byte[1024];
                    int len;
                    while ((len = originalStream.read(buffer)) != -1) {
                        byteBuffer.write(buffer, 0, len);
                    }
                    byte[] pdfBytes = byteBuffer.toByteArray();

                    try (PDDocument document = Loader.loadPDF(pdfBytes)) {
                        if (document.getNumberOfPages() > 0) {
                            PDFRenderer pdfRenderer = new PDFRenderer(document);
                            BufferedImage bim = pdfRenderer.renderImageWithDPI(0, 150); // render first page
                            ByteArrayOutputStream os = new ByteArrayOutputStream();
                            Thumbnails.of(bim)
                                    .size(200, 200)
                                    .outputFormat("jpg")
                                    .toOutputStream(os);
                            thumbnailBytes = os.toByteArray();
                        } else {
                            System.out.println("PDF document has no pages. ID: " + fileId);
                        }
                    }
                }
            }

            if (thumbnailBytes != null && thumbnailBytes.length > 0) {
                // 2. Upload thumbnail to MinIO
                String thumbnailObjectName = "thumb_" + file.getStoragePath();
                try (ByteArrayInputStream bis = new ByteArrayInputStream(thumbnailBytes)) {
                    minioClient.putObject(
                            PutObjectArgs.builder()
                                    .bucket(BUCKET_NAME)
                                    .object(thumbnailObjectName)
                                    .stream(bis, thumbnailBytes.length, -1)
                                    .contentType("image/jpeg")
                                    .build()
                    );
                }

                // 3. Update database
                file.setHasThumbnail(true);
                fileRepository.save(file);
                System.out.println("Successfully generated thumbnail for file ID: " + fileId);
            }

        } catch (Exception e) {
            System.err.println("Error generating thumbnail for file ID " + fileIdString + ": " + e.getMessage());
            e.printStackTrace();
        }
    }

    @RabbitListener(queues = RabbitMQConfig.EXIF_EXTRACTION_QUEUE)
    public void handleExifExtraction(String fileId) {
        System.out.println("Extracting EXIF data for file ID: " + fileId);
    }
}
