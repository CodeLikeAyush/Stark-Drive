package com.family.drive.repository;

import com.family.drive.model.DriveFile;
import com.family.drive.model.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface DriveFileRepository extends JpaRepository<DriveFile, Long> {
    List<DriveFile> findByUserAndFolderIsNullAndIsVaultFalseAndIsBackupFalse(User user);
    List<DriveFile> findByFolderIdAndUserAndIsVaultFalseAndIsBackupFalse(Long folderId, User user);
    Optional<DriveFile> findByFileHash(String fileHash); // For deduplication check
    long countByFileHash(String fileHash);
    List<DriveFile> findByNameContainingIgnoreCaseAndUserAndIsVaultFalseAndIsBackupFalse(String name, User user);
    List<DriveFile> findByUserAndIsVaultTrue(User user);
    List<DriveFile> findByUserAndIsVaultFalseAndInBinFalseAndContentTypeStartingWith(User user, String contentTypePrefix);
    List<DriveFile> findByUserAndIsVaultFalseAndInBinTrueAndContentTypeStartingWith(User user, String contentTypePrefix);
    
    @org.springframework.data.jpa.repository.Query("SELECT COALESCE(SUM(d.sizeBytes), 0) FROM DriveFile d WHERE d.user = :user")
    Long sumSizeBytesByUser(@org.springframework.data.repository.query.Param("user") User user);
}
