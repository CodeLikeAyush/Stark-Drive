package com.family.drive.repository;

import com.family.drive.model.DriveFolder;
import com.family.drive.model.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface DriveFolderRepository extends JpaRepository<DriveFolder, Long> {
    List<DriveFolder> findByUserAndParentFolderIsNull(User user);
    List<DriveFolder> findByParentFolderIdAndUser(Long parentFolderId, User user);
    List<DriveFolder> findByNameContainingIgnoreCaseAndUser(String name, User user);
    List<DriveFolder> findAllByUser(User user);
}
