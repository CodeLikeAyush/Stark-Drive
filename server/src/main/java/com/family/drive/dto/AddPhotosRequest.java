package com.family.drive.dto;

import java.util.List;

public class AddPhotosRequest {
    private List<Long> photoIds;

    public AddPhotosRequest() {}

    public AddPhotosRequest(List<Long> photoIds) {
        this.photoIds = photoIds;
    }

    public List<Long> getPhotoIds() {
        return photoIds;
    }

    public void setPhotoIds(List<Long> photoIds) {
        this.photoIds = photoIds;
    }
}
