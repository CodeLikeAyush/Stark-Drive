package com.family.drive.dto;

public class AlbumSummaryResponse {
    private Long id;
    private String name;
    private String description;
    private Long creationTime;
    private Long coverPhotoId;
    private int photoCount;

    public AlbumSummaryResponse() {}

    public AlbumSummaryResponse(Long id, String name, String description, Long creationTime, Long coverPhotoId, int photoCount) {
        this.id = id;
        this.name = name;
        this.description = description;
        this.creationTime = creationTime;
        this.coverPhotoId = coverPhotoId;
        this.photoCount = photoCount;
    }

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public Long getCreationTime() {
        return creationTime;
    }

    public void setCreationTime(Long creationTime) {
        this.creationTime = creationTime;
    }

    public Long getCoverPhotoId() {
        return coverPhotoId;
    }

    public void setCoverPhotoId(Long coverPhotoId) {
        this.coverPhotoId = coverPhotoId;
    }

    public int getPhotoCount() {
        return photoCount;
    }

    public void setPhotoCount(int photoCount) {
        this.photoCount = photoCount;
    }
}
