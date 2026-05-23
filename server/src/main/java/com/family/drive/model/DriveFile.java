package com.family.drive.model;

import jakarta.persistence.*;

@Entity
@Table(name = "files")
public class DriveFile {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String name;

    @Column(nullable = false)
    private String originalFilename;

    @Column(nullable = false)
    private String storagePath; // MinIO object key

    @Column(nullable = false)
    private Long sizeBytes;

    @Column(nullable = false)
    private String contentType;

    @Column(nullable = false, length = 64)
    private String fileHash; // SHA-256 for deduplication

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "folder_id")
    @com.fasterxml.jackson.annotation.JsonIgnore
    private DriveFolder folder; // If null, it's in the user's root

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    @com.fasterxml.jackson.annotation.JsonIgnore
    private User user;

    @Column(name = "is_vault", nullable = false, columnDefinition = "boolean default false")
    private boolean isVault = false;

    @Column(name = "is_backup", nullable = false, columnDefinition = "boolean default false")
    private boolean isBackup = false;

    @Column(name = "in_bin", nullable = false, columnDefinition = "boolean default false")
    private boolean inBin = false;

    @Column(name = "creation_time")
    private Long creationTime;

    public DriveFile() {}

    public DriveFile(String name, String originalFilename, String storagePath, Long sizeBytes, String contentType, String fileHash, DriveFolder folder, User user) {
        this.name = name;
        this.originalFilename = originalFilename;
        this.storagePath = storagePath;
        this.sizeBytes = sizeBytes;
        this.contentType = contentType;
        this.fileHash = fileHash;
        this.folder = folder;
        this.user = user;
    }

    // Getters and Setters
    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getOriginalFilename() { return originalFilename; }
    public void setOriginalFilename(String originalFilename) { this.originalFilename = originalFilename; }
    public String getStoragePath() { return storagePath; }
    public void setStoragePath(String storagePath) { this.storagePath = storagePath; }
    public Long getSizeBytes() { return sizeBytes; }
    public void setSizeBytes(Long sizeBytes) { this.sizeBytes = sizeBytes; }
    public String getContentType() { return contentType; }
    public void setContentType(String contentType) { this.contentType = contentType; }
    public String getFileHash() { return fileHash; }
    public void setFileHash(String fileHash) { this.fileHash = fileHash; }
    public DriveFolder getFolder() { return folder; }
    public void setFolder(DriveFolder folder) { this.folder = folder; }
    public User getUser() { return user; }
    public void setUser(User user) { this.user = user; }
    public boolean isVault() { return isVault; }
    public void setVault(boolean vault) { isVault = vault; }
    public boolean isInBin() { return inBin; }
    public void setInBin(boolean inBin) { this.inBin = inBin; }
    public boolean isBackup() { return isBackup; }
    public void setBackup(boolean backup) { isBackup = backup; }
    public Long getCreationTime() { return creationTime; }
    public void setCreationTime(Long creationTime) { this.creationTime = creationTime; }
}
