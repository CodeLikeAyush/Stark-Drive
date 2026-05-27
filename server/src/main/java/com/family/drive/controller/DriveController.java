package com.family.drive.controller;

import com.family.drive.model.DriveFolder;
import com.family.drive.model.User;
import com.family.drive.service.DriveService;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/drive")
public class DriveController {

    private final DriveService driveService;

    public DriveController(DriveService driveService) {
        this.driveService = driveService;
    }

    @PostMapping("/folders")
    public ResponseEntity<DriveFolder> createFolder(
            @RequestParam String name,
            @RequestParam(required = false) Long parentId,
            @AuthenticationPrincipal User user
    ) {
        return ResponseEntity.ok(driveService.createFolder(name, parentId, user));
    }

    @GetMapping("/list")
    public ResponseEntity<Map<String, Object>> listDirectory(
            @RequestParam(required = false) Long folderId,
            @AuthenticationPrincipal User user
    ) {
        return ResponseEntity.ok(driveService.listDirectory(folderId, user));
    }

    @GetMapping("/search")
    public ResponseEntity<Map<String, Object>> searchDirectory(
            @RequestParam String q,
            @AuthenticationPrincipal User user
    ) {
        return ResponseEntity.ok(driveService.searchDirectory(q, user));
    }

    @PostMapping("/upload")
    public ResponseEntity<com.family.drive.model.DriveFile> uploadFile(
            @RequestParam("file") org.springframework.web.multipart.MultipartFile file,
            @RequestParam(required = false) Long folderId,
            @RequestParam(required = false) String fileHash,
            @RequestParam(required = false) String originalName,
            @RequestParam(required = false, defaultValue = "false") boolean isVault,
            @RequestParam(required = false, defaultValue = "false") boolean isBackup,
            @RequestParam(required = false) Long creationTime,
            @AuthenticationPrincipal User user
    ) throws Exception {
        return ResponseEntity.ok(driveService.uploadFile(file, folderId, fileHash, originalName, isVault, isBackup, creationTime, user));
    }

    @GetMapping("/download/{fileId}")
    public ResponseEntity<org.springframework.core.io.InputStreamResource> downloadFile(
            @PathVariable Long fileId,
            @AuthenticationPrincipal User user
    ) throws Exception {
        io.minio.GetObjectResponse stream = driveService.downloadFile(fileId, user);
        
        org.springframework.http.HttpHeaders headers = new org.springframework.http.HttpHeaders();
        headers.add(org.springframework.http.HttpHeaders.CONTENT_DISPOSITION, "attachment");
        headers.add(org.springframework.http.HttpHeaders.CONTENT_TYPE, stream.headers().get("Content-Type"));
        
        return ResponseEntity.ok()
                .headers(headers)
                .body(new org.springframework.core.io.InputStreamResource(stream));
    }

    @GetMapping("/thumbnail/{fileId}")
    public ResponseEntity<org.springframework.core.io.InputStreamResource> downloadThumbnail(
            @PathVariable Long fileId,
            @AuthenticationPrincipal User user
    ) throws Exception {
        io.minio.GetObjectResponse stream = driveService.downloadThumbnail(fileId, user);
        
        org.springframework.http.HttpHeaders headers = new org.springframework.http.HttpHeaders();
        headers.add(org.springframework.http.HttpHeaders.CACHE_CONTROL, "public, max-age=31536000"); // 1 year cache
        headers.add(org.springframework.http.HttpHeaders.CONTENT_TYPE, "image/jpeg");
        
        return ResponseEntity.ok()
                .headers(headers)
                .body(new org.springframework.core.io.InputStreamResource(stream));
    }

    @DeleteMapping("/items/{type}/{id}")
    public ResponseEntity<Void> deleteItem(
            @PathVariable String type,
            @PathVariable Long id,
            @AuthenticationPrincipal User user
    ) {
        if ("folder".equals(type)) driveService.deleteFolder(id, user);
        else driveService.deleteFile(id, user);
        return ResponseEntity.ok().build();
    }

    @PatchMapping("/items/{type}/{id}/rename")
    public ResponseEntity<Void> renameItem(
            @PathVariable String type,
            @PathVariable Long id,
            @RequestParam String newName,
            @AuthenticationPrincipal User user
    ) {
        if ("folder".equals(type)) driveService.renameFolder(id, newName, user);
        else driveService.renameFile(id, newName, user);
        return ResponseEntity.ok().build();
    }

    @PatchMapping("/items/{type}/{id}/move")
    public ResponseEntity<Void> moveItem(
            @PathVariable String type,
            @PathVariable Long id,
            @RequestParam(required = false) Long targetFolderId,
            @AuthenticationPrincipal User user
    ) {
        if ("folder".equals(type)) driveService.moveFolder(id, targetFolderId, user);
        else driveService.moveFile(id, targetFolderId, user);
        return ResponseEntity.ok().build();
    }

    @GetMapping("/folders/all")
    public ResponseEntity<List<DriveFolder>> getAllFolders(@AuthenticationPrincipal User user) {
        return ResponseEntity.ok(driveService.getAllFolders(user));
    }

    @GetMapping("/vault/list")
    public ResponseEntity<List<com.family.drive.model.DriveFile>> getVaultFiles(@AuthenticationPrincipal User user) {
        return ResponseEntity.ok(driveService.getVaultFiles(user));
    }

    @GetMapping("/photos")
    public ResponseEntity<List<com.family.drive.model.DriveFile>> getTimelinePhotos(@AuthenticationPrincipal User user) {
        return ResponseEntity.ok(driveService.getTimelinePhotos(user));
    }

    @GetMapping("/photos/bin")
    public ResponseEntity<List<com.family.drive.model.DriveFile>> getBinPhotos(@AuthenticationPrincipal User user) {
        return ResponseEntity.ok(driveService.getBinPhotos(user));
    }

    @PutMapping("/photos/trash")
    public ResponseEntity<Void> trashPhotos(@RequestBody List<Long> ids, @AuthenticationPrincipal User user) {
        driveService.trashPhotos(ids, user);
        return ResponseEntity.ok().build();
    }

    @PutMapping("/photos/restore")
    public ResponseEntity<Void> restorePhotos(@RequestBody List<Long> ids, @AuthenticationPrincipal User user) {
        driveService.restorePhotos(ids, user);
        return ResponseEntity.ok().build();
    }

    @PostMapping("/photos/delete")
    public ResponseEntity<Void> deletePhotos(@RequestBody List<Long> ids, @AuthenticationPrincipal User user) {
        driveService.deletePhotos(ids, user);
        return ResponseEntity.ok().build();
    }

    @GetMapping("/storage")
    public ResponseEntity<Long> getStorageUsed(@AuthenticationPrincipal User user) {
        return ResponseEntity.ok(driveService.getStorageUsed(user));
    }
}
