package com.family.drive.service;

import com.family.drive.dto.AlbumRequest;
import com.family.drive.dto.AlbumSummaryResponse;
import com.family.drive.dto.AlbumDetailsResponse;
import com.family.drive.dto.AddPhotosRequest;
import com.family.drive.model.Album;
import com.family.drive.model.DriveFile;
import com.family.drive.model.User;
import com.family.drive.repository.AlbumRepository;
import com.family.drive.repository.DriveFileRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.stream.Collectors;

@Service
@Transactional
public class AlbumService {

    private final AlbumRepository albumRepository;
    private final DriveFileRepository fileRepository;

    public AlbumService(AlbumRepository albumRepository, DriveFileRepository fileRepository) {
        this.albumRepository = albumRepository;
        this.fileRepository = fileRepository;
    }

    public AlbumDetailsResponse createAlbum(AlbumRequest request, User user) {
        Album album = new Album(request.getName(), request.getDescription(), user);
        if (request.getPhotoIds() != null && !request.getPhotoIds().isEmpty()) {
            List<DriveFile> photos = fileRepository.findAllById(request.getPhotoIds());
            // Filter to make sure photos belong to the authenticated user
            List<DriveFile> userPhotos = photos.stream()
                .filter(p -> p.getUser().getId().equals(user.getId()))
                .collect(Collectors.toList());
            album.setPhotos(userPhotos);
        }
        Album saved = albumRepository.save(album);
        return mapToDetails(saved);
    }

    public List<AlbumSummaryResponse> listAlbums(User user) {
        List<Album> albums = albumRepository.findByUserOrderByCreationTimeDesc(user);
        return albums.stream().map(this::mapToSummary).collect(Collectors.toList());
    }

    public AlbumDetailsResponse getAlbumDetails(Long id, User user) {
        Album album = albumRepository.findByIdAndUser(id, user)
            .orElseThrow(() -> new RuntimeException("Album not found"));
        return mapToDetails(album);
    }

    public AlbumDetailsResponse addPhotos(Long id, AddPhotosRequest request, User user) {
        Album album = albumRepository.findByIdAndUser(id, user)
            .orElseThrow(() -> new RuntimeException("Album not found"));
        
        if (request.getPhotoIds() != null && !request.getPhotoIds().isEmpty()) {
            List<DriveFile> photos = fileRepository.findAllById(request.getPhotoIds());
            List<DriveFile> userPhotos = photos.stream()
                .filter(p -> p.getUser().getId().equals(user.getId()))
                .filter(p -> !album.getPhotos().contains(p))
                .collect(Collectors.toList());
            
            album.getPhotos().addAll(userPhotos);
            Album saved = albumRepository.save(album);
            return mapToDetails(saved);
        }
        return mapToDetails(album);
    }

    public AlbumDetailsResponse removePhotos(Long id, AddPhotosRequest request, User user) {
        Album album = albumRepository.findByIdAndUser(id, user)
            .orElseThrow(() -> new RuntimeException("Album not found"));
        
        if (request.getPhotoIds() != null && !request.getPhotoIds().isEmpty()) {
            album.getPhotos().removeIf(p -> request.getPhotoIds().contains(p.getId()));
            Album saved = albumRepository.save(album);
            return mapToDetails(saved);
        }
        return mapToDetails(album);
    }

    public void deleteAlbum(Long id, User user) {
        Album album = albumRepository.findByIdAndUser(id, user)
            .orElseThrow(() -> new RuntimeException("Album not found"));
        albumRepository.delete(album);
    }

    private AlbumSummaryResponse mapToSummary(Album album) {
        Long coverPhotoId = null;
        if (!album.getPhotos().isEmpty()) {
            coverPhotoId = album.getPhotos().get(0).getId();
        }
        return new AlbumSummaryResponse(
            album.getId(),
            album.getName(),
            album.getDescription(),
            album.getCreationTime(),
            coverPhotoId,
            album.getPhotos().size()
        );
    }

    private AlbumDetailsResponse mapToDetails(Album album) {
        return new AlbumDetailsResponse(
            album.getId(),
            album.getName(),
            album.getDescription(),
            album.getCreationTime(),
            album.getPhotos()
        );
    }
}
