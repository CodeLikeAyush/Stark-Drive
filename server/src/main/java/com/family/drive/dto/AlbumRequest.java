package com.family.drive.dto;

import java.util.List;

public class AlbumRequest {
    private String name;
    private String description;
    private List<Long> photoIds;

    public AlbumRequest() {}

    public AlbumRequest(String name, String description, List<Long> photoIds) {
        this.name = name;
        this.description = description;
        this.photoIds = photoIds;
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

    public List<Long> getPhotoIds() {
        return photoIds;
    }

    public void setPhotoIds(List<Long> photoIds) {
        this.photoIds = photoIds;
    }
}
