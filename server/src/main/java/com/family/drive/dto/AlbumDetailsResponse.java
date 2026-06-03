package com.family.drive.dto;

import com.family.drive.model.DriveFile;
import java.util.List;

public class AlbumDetailsResponse {
    private Long id;
    private String name;
    private String description;
    private Long creationTime;
    private List<DriveFile> photos;

    public AlbumDetailsResponse() {}

    public AlbumDetailsResponse(Long id, String name, String description, Long creationTime, List<DriveFile> photos) {
        this.id = id;
        this.name = name;
        this.description = description;
        this.creationTime = creationTime;
        this.photos = photos;
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

    public List<DriveFile> getPhotos() {
        return photos;
    }

    public void setPhotos(List<DriveFile> photos) {
        this.photos = photos;
    }
}
