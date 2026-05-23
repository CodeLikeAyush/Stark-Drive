package com.family.drive.model;

import jakarta.persistence.*;

import java.util.ArrayList;
import java.util.List;

@Entity
@Table(name = "folders")
public class DriveFolder {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String name;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    @com.fasterxml.jackson.annotation.JsonIgnore
    private User user;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "parent_folder_id")
    @com.fasterxml.jackson.annotation.JsonIgnore
    private DriveFolder parentFolder;

    @OneToMany(mappedBy = "parentFolder", cascade = CascadeType.ALL, orphanRemoval = true)
    @com.fasterxml.jackson.annotation.JsonIgnore
    private List<DriveFolder> subFolders = new ArrayList<>();

    @OneToMany(mappedBy = "folder", cascade = CascadeType.ALL, orphanRemoval = true)
    @com.fasterxml.jackson.annotation.JsonIgnore
    private List<DriveFile> files = new ArrayList<>();

    public DriveFolder() {}

    public DriveFolder(String name, User user, DriveFolder parentFolder) {
        this.name = name;
        this.user = user;
        this.parentFolder = parentFolder;
    }

    // Getters and Setters
    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public User getUser() { return user; }
    public void setUser(User user) { this.user = user; }
    public DriveFolder getParentFolder() { return parentFolder; }
    public void setParentFolder(DriveFolder parentFolder) { this.parentFolder = parentFolder; }
    public List<DriveFolder> getSubFolders() { return subFolders; }
    public void setSubFolders(List<DriveFolder> subFolders) { this.subFolders = subFolders; }
    public List<DriveFile> getFiles() { return files; }
    public void setFiles(List<DriveFile> files) { this.files = files; }
}
