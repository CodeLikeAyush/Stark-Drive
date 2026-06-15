package com.family.drive.service;

import com.family.drive.model.DriveFile;
import com.family.drive.model.DriveFolder;
import com.family.drive.model.User;
import com.family.drive.repository.DriveFileRepository;
import com.family.drive.repository.DriveFolderRepository;
import com.family.drive.config.RabbitMQConfig;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
public class DriveService {

    private final DriveFolderRepository folderRepository;
    private final DriveFileRepository fileRepository;
    private final io.minio.MinioClient minioClient;
    private final RabbitTemplate rabbitTemplate;
    private final String BUCKET_NAME = "family-drive";

    public DriveService(DriveFolderRepository folderRepository, DriveFileRepository fileRepository, io.minio.MinioClient minioClient, RabbitTemplate rabbitTemplate) {
        this.folderRepository = folderRepository;
        this.fileRepository = fileRepository;
        this.minioClient = minioClient;
        this.rabbitTemplate = rabbitTemplate;
        
        try {
            boolean found = minioClient.bucketExists(io.minio.BucketExistsArgs.builder().bucket(BUCKET_NAME).build());
            if (!found) {
                minioClient.makeBucket(io.minio.MakeBucketArgs.builder().bucket(BUCKET_NAME).build());
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    public DriveFolder createFolder(String name, Long parentFolderId, User user) {
        DriveFolder parent = null;
        if (parentFolderId != null) {
            parent = folderRepository.findById(parentFolderId)
                    .orElseThrow(() -> new RuntimeException("Parent folder not found"));
            if (!parent.getUser().getId().equals(user.getId())) {
                throw new RuntimeException("Unauthorized");
            }
        }

        DriveFolder folder = new DriveFolder(name, user, parent);
        return folderRepository.save(folder);
    }

    public Map<String, Object> listDirectory(Long folderId, User user) {
        List<DriveFolder> folders;
        List<DriveFile> files;

        if (folderId == null) {
            folders = folderRepository.findByUserAndParentFolderIsNull(user);
            files = fileRepository.findByUserAndFolderIsNullAndIsVaultFalseAndIsBackupFalse(user);
        } else {
            // Verify access
            DriveFolder parent = folderRepository.findById(folderId)
                    .orElseThrow(() -> new RuntimeException("Folder not found"));
            if (!parent.getUser().getId().equals(user.getId())) {
                throw new RuntimeException("Unauthorized");
            }
            folders = folderRepository.findByParentFolderIdAndUser(folderId, user);
            files = fileRepository.findByFolderIdAndUserAndIsVaultFalseAndIsBackupFalse(folderId, user);
        }

        Map<String, Object> result = new HashMap<>();
        result.put("folders", folders);
        result.put("files", files);
        return result;
    }

    public Map<String, Object> searchDirectory(String query, User user) {
        List<DriveFolder> folders = folderRepository.findByNameContainingIgnoreCaseAndUser(query, user);
        List<DriveFile> files = fileRepository.findByNameContainingIgnoreCaseAndUserAndIsVaultFalseAndIsBackupFalse(query, user);

        Map<String, Object> result = new HashMap<>();
        result.put("folders", folders);
        result.put("files", files);
        return result;
    }

    public List<DriveFolder> getAllFolders(User user) {
        return folderRepository.findAllByUser(user);
    }

    public List<DriveFile> getVaultFiles(User user) {
        return fileRepository.findByUserAndIsVaultTrue(user);
    }

    public List<DriveFile> getTimelinePhotos(User user) {
        return fileRepository.findByUserAndIsVaultFalseAndInBinFalseAndContentTypeStartingWith(user, "image/");
    }

    public List<DriveFile> getBinPhotos(User user) {
        return fileRepository.findByUserAndIsVaultFalseAndInBinTrueAndContentTypeStartingWith(user, "image/");
    }

    public void trashPhotos(List<Long> ids, User user) {
        List<DriveFile> files = fileRepository.findAllById(ids);
        files.forEach(f -> {
            if (f.getUser().getId().equals(user.getId())) {
                f.setInBin(true);
            }
        });
        fileRepository.saveAll(files);
    }

    public void restorePhotos(List<Long> ids, User user) {
        List<DriveFile> files = fileRepository.findAllById(ids);
        files.forEach(f -> {
            if (f.getUser().getId().equals(user.getId())) {
                f.setInBin(false);
            }
        });
        fileRepository.saveAll(files);
    }

    public void deletePhotos(List<Long> ids, User user) {
        List<DriveFile> files = fileRepository.findAllById(ids);
        for (DriveFile f : files) {
            if (f.getUser().getId().equals(user.getId()) && f.isInBin()) {
                // Delete from MinIO if no other file shares this hash
                if (fileRepository.countByFileHash(f.getFileHash()) == 1) {
                    try {
                        minioClient.removeObject(io.minio.RemoveObjectArgs.builder()
                                .bucket(BUCKET_NAME)
                                .object(f.getStoragePath())
                                .build());
                    } catch (Exception e) {
                        e.printStackTrace();
                    }
                }
                fileRepository.delete(f);
            }
        }
    }

    public DriveFile uploadFile(org.springframework.web.multipart.MultipartFile file, Long folderId, String fileHash, String originalName, boolean isVault, boolean isBackup, Long creationTime, User user) throws Exception {
        DriveFolder parent = null;
        if (folderId != null) {
            parent = folderRepository.findById(folderId)
                    .orElseThrow(() -> new RuntimeException("Folder not found"));
            if (!parent.getUser().getId().equals(user.getId())) {
                throw new RuntimeException("Unauthorized");
            }
        }

        String objectName = fileHash != null && !fileHash.isEmpty() ? fileHash : java.util.UUID.randomUUID().toString();

        boolean existsInDb = fileRepository.findByUserAndFolderIsNullAndIsVaultFalseAndIsBackupFalse(user).stream()
                .anyMatch(f -> objectName.equals(f.getStoragePath())); 
        
        if (!existsInDb) {
            minioClient.putObject(
                io.minio.PutObjectArgs.builder()
                    .bucket(BUCKET_NAME)
                    .object(objectName)
                    .stream(file.getInputStream(), file.getSize(), -1)
                    .contentType(file.getContentType())
                    .build()
            );
        }

        String finalName = (originalName != null && !originalName.isEmpty()) ? originalName : file.getOriginalFilename();

        DriveFile driveFile = new DriveFile(
                finalName,                  // name
                finalName,                  // originalFilename
                objectName,                 // storagePath
                file.getSize(),             // sizeBytes
                file.getContentType(),      // contentType
                objectName,                 // fileHash
                parent,                     // folder
                user                        // user
        );
        driveFile.setVault(isVault);
        driveFile.setBackup(isBackup);
        driveFile.setCreationTime(creationTime != null ? creationTime : System.currentTimeMillis());
        
        DriveFile savedFile = fileRepository.save(driveFile);
        
        if (!isVault) {
            String cType = file.getContentType();
            String nameLower = finalName.toLowerCase();
            boolean isImage = (cType != null && cType.startsWith("image/")) 
                    || nameLower.endsWith(".jpg") || nameLower.endsWith(".jpeg") 
                    || nameLower.endsWith(".png") || nameLower.endsWith(".gif") 
                    || nameLower.endsWith(".webp") || nameLower.endsWith(".bmp");
            boolean isPdf = (cType != null && cType.equals("application/pdf")) 
                    || nameLower.endsWith(".pdf");
            
            if (isImage || isPdf) {
                try {
                    rabbitTemplate.convertAndSend(RabbitMQConfig.MEDIA_PROCESSING_QUEUE, savedFile.getId().toString());
                } catch (Exception e) {
                    System.err.println("Failed to publish thumbnail message to RabbitMQ: " + e.getMessage());
                }
            }
        }
        
        return savedFile;
    }

    public io.minio.GetObjectResponse downloadFile(Long fileId, User user) throws Exception {
        DriveFile driveFile = fileRepository.findById(fileId)
                .orElseThrow(() -> new RuntimeException("File not found"));

        if (!driveFile.getUser().getId().equals(user.getId())) {
            throw new RuntimeException("Unauthorized");
        }

        return minioClient.getObject(
                io.minio.GetObjectArgs.builder()
                        .bucket(BUCKET_NAME)
                        .object(driveFile.getStoragePath())
                        .build()
        );
    }

    public io.minio.GetObjectResponse downloadThumbnail(Long fileId, User user) throws Exception {
        DriveFile driveFile = fileRepository.findById(fileId)
                .orElseThrow(() -> new RuntimeException("File not found"));

        if (!driveFile.getUser().getId().equals(user.getId())) {
            throw new RuntimeException("Unauthorized");
        }

        if (!driveFile.isHasThumbnail()) {
            // Asynchronously generate thumbnail for future requests if it is an image or PDF
            String contentType = driveFile.getContentType();
            String nameLower = driveFile.getOriginalFilename().toLowerCase();
            boolean isImage = (contentType != null && contentType.startsWith("image/"))
                    || nameLower.endsWith(".jpg") || nameLower.endsWith(".jpeg")
                    || nameLower.endsWith(".png") || nameLower.endsWith(".gif")
                    || nameLower.endsWith(".webp") || nameLower.endsWith(".bmp");
            boolean isPdf = (contentType != null && contentType.equals("application/pdf"))
                    || nameLower.endsWith(".pdf");

            if (isImage || isPdf) {
                try {
                    rabbitTemplate.convertAndSend(RabbitMQConfig.MEDIA_PROCESSING_QUEUE, driveFile.getId().toString());
                } catch (Exception e) {
                    System.err.println("Failed to publish thumbnail message to RabbitMQ on fallback: " + e.getMessage());
                }
            }

            // Fallback: return the original file stream
            return minioClient.getObject(
                    io.minio.GetObjectArgs.builder()
                            .bucket(BUCKET_NAME)
                            .object(driveFile.getStoragePath())
                            .build()
            );
        }

        return minioClient.getObject(
                io.minio.GetObjectArgs.builder()
                        .bucket(BUCKET_NAME)
                        .object("thumb_" + driveFile.getStoragePath())
                        .build()
        );
    }

    public void deleteFolder(Long id, User user) {
        DriveFolder folder = folderRepository.findById(id).orElseThrow(() -> new RuntimeException("Folder not found"));
        if (!folder.getUser().getId().equals(user.getId())) throw new RuntimeException("Unauthorized");
        deleteFolderRecursively(folder);
    }

    private void deleteFolderRecursively(DriveFolder folder) {
        for (DriveFolder sub : folder.getSubFolders()) {
            deleteFolderRecursively(sub);
        }
        for (DriveFile file : folder.getFiles()) {
            deleteFileInternal(file);
        }
        folderRepository.delete(folder);
    }

    public void deleteFile(Long id, User user) {
        DriveFile file = fileRepository.findById(id).orElseThrow(() -> new RuntimeException("File not found"));
        if (!file.getUser().getId().equals(user.getId())) throw new RuntimeException("Unauthorized");
        deleteFileInternal(file);
    }

    private void deleteFileInternal(DriveFile file) {
        boolean shouldRemoveFromMinio = fileRepository.countByFileHash(file.getFileHash()) <= 1;
        fileRepository.delete(file);
        if (shouldRemoveFromMinio) {
            try {
                minioClient.removeObject(io.minio.RemoveObjectArgs.builder()
                        .bucket(BUCKET_NAME)
                        .object(file.getStoragePath())
                        .build());
            } catch (Exception e) {
                System.err.println("MinIO delete failed: " + e.getMessage());
            }
        }
    }

    public void renameFolder(Long id, String newName, User user) {
        DriveFolder folder = folderRepository.findById(id).orElseThrow();
        if (!folder.getUser().getId().equals(user.getId())) throw new RuntimeException("Unauthorized");
        folder.setName(newName);
        folderRepository.save(folder);
    }

    public void renameFile(Long id, String newName, User user) {
        DriveFile file = fileRepository.findById(id).orElseThrow();
        if (!file.getUser().getId().equals(user.getId())) throw new RuntimeException("Unauthorized");
        file.setOriginalFilename(newName);
        fileRepository.save(file);
    }

    public void moveFolder(Long id, Long targetFolderId, User user) {
        DriveFolder folder = folderRepository.findById(id).orElseThrow();
        if (!folder.getUser().getId().equals(user.getId())) throw new RuntimeException("Unauthorized");
        if (targetFolderId != null) {
            if (targetFolderId.equals(id)) throw new RuntimeException("Cannot move into itself");
            DriveFolder target = folderRepository.findById(targetFolderId).orElseThrow();
            if (!target.getUser().getId().equals(user.getId())) throw new RuntimeException("Unauthorized");
            folder.setParentFolder(target);
        } else {
            folder.setParentFolder(null);
        }
        folderRepository.save(folder);
    }

    public void moveFile(Long id, Long targetFolderId, User user) {
        DriveFile file = fileRepository.findById(id).orElseThrow();
        if (!file.getUser().getId().equals(user.getId())) throw new RuntimeException("Unauthorized");
        if (targetFolderId != null) {
            DriveFolder target = folderRepository.findById(targetFolderId).orElseThrow();
            if (!target.getUser().getId().equals(user.getId())) throw new RuntimeException("Unauthorized");
            file.setFolder(target);
        } else {
            file.setFolder(null);
        }
        fileRepository.save(file);
    }

    public Long getStorageUsed(User user) {
        return fileRepository.sumSizeBytesByUser(user);
    }
}
